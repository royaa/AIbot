import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../models/chat_session.dart';
import '../models/tool_catalog.dart';
import '../utils/output_parser.dart';
import 'relay_client.dart';
import 'session_store.dart';
import 'settings_store.dart';

class ChatHub extends ChangeNotifier {
  ChatHub._(this.client) {
    client.onMessage = _onMessage;
    client.onAuthenticated = requestCatchup;
  }

  static Future<ChatHub> create(RelayClient client) async {
    final hub = ChatHub._(client);
    hub.toolModels = await SessionStore.loadToolModelsCache();
    hub.toolCatalog = await SessionStore.loadToolCatalogCache();
    hub._enabledChatCliIds = await SettingsStore.loadEnabledChatCliIds();
    final loaded = await SessionStore.load(catalog: hub.toolCatalog);
    if (loaded != null && loaded.sessions.isNotEmpty) {
      hub.sessions.addAll(loaded.sessions);
      hub.currentSessionId =
          loaded.currentId ?? loaded.sessions.first.id;
    } else {
      hub.newSession();
    }
    hub._rebuildTaskMaps();
    hub._clampSessionToolsToVisible();
    return hub;
  }

  @override
  void notifyListeners() {
    super.notifyListeners();
    SessionStore.save(sessions: sessions, currentId: currentSessionId);
  }

  final RelayClient client;
  final sessions = <ChatSession>[];
  String? currentSessionId;
  final Map<String, String> _taskToSession = {};
  List<Map<String, String>> workspaces = [
    {'id': 'grokbot', 'name': 'AI Bot'},
  ];
  Map<String, List<Map<String, String>>> toolModels = {};
  List<ToolCatalogEntry> toolCatalog = List.of(defaultToolCatalog);
  /// null = 全部对话 CLI；非空 = 设置页勾选子集
  Set<String>? _enabledChatCliIds;
  int _cancelGen = 0;

  ChatSession get current {
    final id = currentSessionId;
    if (id == null) throw StateError('no session');
    return sessions.firstWhere((s) => s.id == id);
  }

  /// 设置页可选的全部对话 CLI（不含取文件等动作）
  List<ToolCatalogEntry> get availableChatTools =>
      chatSelectableCatalog(toolCatalog);

  /// 聊天底部实际展示的 CLI（已应用用户勾选）
  List<ToolCatalogEntry> get primaryTools =>
      SettingsStore.resolveVisibleChatTools(
        catalog: toolCatalog,
        enabledIds: _enabledChatCliIds,
      );

  Future<void> applyChatCliVisibility(Set<String> enabledIds) async {
    _enabledChatCliIds = Set.of(enabledIds);
    await SettingsStore.saveEnabledChatCliIds(_enabledChatCliIds!);
    _clampSessionToolsToVisible();
    notifyListeners();
  }

  void _clampSessionToolsToVisible() {
    final visible = primaryTools;
    for (final s in sessions) {
      final next = SettingsStore.sanitizeVisibleTool(
        ChatSession.sanitizeTool(s.tool, catalog: toolCatalog),
        visible: visible,
      );
      if (s.tool != next) s.tool = next;
    }
  }

  String toolLabel(String tool) {
    for (final e in toolCatalog) {
      if (e.id == tool) return e.label;
    }
    return tool;
  }

  /// 从未完成 turn 恢复 activeTaskIds / _taskToSession（热重载、杀进程后）
  void _rebuildTaskMaps() {
    _taskToSession.clear();
    for (final s in sessions) {
      s.activeTaskIds.clear();
      for (final t in s.turns) {
        final tid = t.taskId;
        if (t.isUser || tid == null) continue;
        _taskToSession[tid] = s.id;
        if (!t.finished) {
          s.activeTaskIds.add(tid);
        }
      }
    }
  }

  List<Map<String, String>> modelsForTool(String tool) {
    if (!ChatSession.supportsModelSelection(tool, catalog: toolCatalog)) {
      return const [];
    }
    final key = ChatSession.normalizeModelTool(tool);
    return toolModels[key] ?? const [];
  }

  String modelLabelFor(String tool, String? modelId) {
    if (modelId == null || modelId.isEmpty) return '默认';
    for (final m in modelsForTool(tool)) {
      if (m['id'] == modelId) return m['label'] ?? modelId;
    }
    return modelId;
  }

  void setSessionTool(String sessionId, String tool) {
    final s = _findSession(sessionId);
    if (s == null) return;
    final sanitized = ChatSession.sanitizeTool(tool, catalog: toolCatalog);
    s.tool = SettingsStore.sanitizeVisibleTool(
      sanitized,
      visible: primaryTools,
    );
    notifyListeners();
  }

  void setSessionModel(String sessionId, String tool, String? modelId) {
    final s = _findSession(sessionId);
    if (s == null) return;
    s.setSelectedModel(tool, modelId, catalog: toolCatalog);
    notifyListeners();
  }

  List<ToolCatalogEntry> _parseCatalog(dynamic raw) {
    if (raw is! List) return const [];
    final out = <ToolCatalogEntry>[];
    for (final item in raw) {
      if (item is Map) {
        final e = ToolCatalogEntry.fromJson(Map<String, dynamic>.from(item));
        if (e.id.isNotEmpty) out.add(e);
      }
    }
    return out;
  }

  void setSessionWorkspace(String sessionId, String workspaceId) {
    final s = _findSession(sessionId);
    if (s == null) return;
    s.workspaceId = workspaceId;
    notifyListeners();
  }

  void newSession() {
    final n = sessions.length + 1;
    final s = ChatSession(title: '会话 $n');
    sessions.insert(0, s);
    currentSessionId = s.id;
    notifyListeners();
  }

  void switchSession(String id) {
    if (sessions.any((s) => s.id == id)) {
      currentSessionId = id;
      notifyListeners();
    }
  }

  void renameSession(String id, String title) {
    final s = _findSession(id);
    if (s != null && title.trim().isNotEmpty) {
      s.title = title.trim();
      notifyListeners();
    }
  }

  void deleteSession(String id) {
    if (sessions.length <= 1) return;
    sessions.removeWhere((s) => s.id == id);
    _taskToSession.removeWhere((_, sid) => sid == id);
    if (currentSessionId == id) {
      currentSessionId = sessions.first.id;
    }
    notifyListeners();
  }

  String _phaseLabel(String status) {
    switch (status) {
      case 'queued':
        return '排队中';
      case 'running':
        return '执行中';
      case 'awaiting_confirm':
        return '待确认';
      case 'completed':
        return '已完成';
      case 'failed':
        return '失败';
      case 'cancelled':
        return '已停止';
      default:
        return status;
    }
  }

  String send({
    required String sessionId,
    required String displayText,
    required String tool,
    required String prompt,
    Map<String, dynamic>? options,
  }) {
    final session = sessions.firstWhere((s) => s.id == sessionId);
    final taskId = client.sendTask(
      sessionId: sessionId,
      workspaceId: session.workspaceId,
      tool: tool,
      prompt: prompt,
      options: options,
    );
    session.turns.add(ChatTurn.user(displayText));
    session.turns.add(ChatTurn.assistant(taskId));
    session.activeTaskIds.add(taskId);
    _taskToSession[taskId] = sessionId;
    if (session.title.startsWith('会话 ') && session.turns.length <= 2) {
      session.title = displayText.length > 18
          ? '${displayText.substring(0, 18)}…'
          : displayText;
    }
    _scheduleWaitHints(sessionId, taskId);
    notifyListeners();
    return taskId;
  }

  void _scheduleWaitHints(String sessionId, String taskId) {
    Future<void>.delayed(const Duration(seconds: 3), () {
      final session = _findSession(sessionId);
      final turn = session?.turnForTask(taskId);
      if (turn == null || turn.finished || turn.body.isNotEmpty) return;
      turn.phase = '思考中…';
      notifyListeners();
    });
    Future<void>.delayed(const Duration(minutes: 1), () {
      final session = _findSession(sessionId);
      final turn = session?.turnForTask(taskId);
      if (turn == null || turn.finished || turn.body.isNotEmpty) return;
      turn.phase = '等待太久了…';
      notifyListeners();
    });
  }

  /// 停止：用未完成 turn 的 taskId（不只依赖 activeTaskIds），并有本地兜底
  void cancelRunningInSession(String sessionId) {
    final session = _findSession(sessionId);
    if (session == null) return;

    final taskIds = <String>{
      ...session.activeTaskIds,
      for (final t in session.turns)
        if (!t.isUser && !t.finished && t.taskId != null) t.taskId!,
    };
    if (taskIds.isEmpty) return;

    for (final taskId in taskIds) {
      session.activeTaskIds.add(taskId);
      _taskToSession[taskId] = sessionId;
      final turn = session.turnForTask(taskId);
      if (turn != null && !turn.finished) {
        turn.phase = '停止中…';
      }
      client.cancelTask(taskId);
    }
    notifyListeners();

    // 断线或 Agent 未回包时，4 秒后本地收口，避免按钮一直无反馈
    final gen = ++_cancelGen;
    Future<void>.delayed(const Duration(seconds: 4), () {
      if (gen != _cancelGen) return;
      final s = _findSession(sessionId);
      if (s == null) return;
      var changed = false;
      for (final taskId in taskIds) {
        final turn = s.turnForTask(taskId);
        if (turn != null && !turn.finished) {
          turn.finished = true;
          turn.phase = '已停止';
          s.activeTaskIds.remove(taskId);
          changed = true;
        }
      }
      if (changed) notifyListeners();
    });
  }

  void requestCatchup() {
    final tasks = <Map<String, dynamic>>[];
    for (final s in sessions) {
      for (final t in s.turns) {
        final tid = t.taskId;
        if (t.isUser || tid == null || t.finished) continue;
        s.activeTaskIds.add(tid);
        _taskToSession[tid] = s.id;
        tasks.add({'taskId': tid, 'afterSeq': t.lastSeq});
      }
    }
    if (tasks.isEmpty) return;
    client.requestCatchup(tasks);
  }

  ChatSession? _findSession(String id) {
    for (final s in sessions) {
      if (s.id == id) return s;
    }
    return null;
  }

  /// Agent 推送的文件：挂到对应任务的回合上（找不到则挂到当前会话）
  void _onFileOffer(Map<String, dynamic> p) {
    final offer = FileOffer.fromJson(p);
    if (offer.fileId.isEmpty || offer.url.isEmpty) return;

    final taskId = p['taskId'] as String?;
    final sessionId = p['sessionId'] as String?;
    ChatSession? session;
    if (taskId != null) session = _sessionForTask(taskId);
    session ??= sessionId != null ? _findSession(sessionId) : null;
    session ??= current;

    ChatTurn? turn =
        taskId != null ? session.turnForTask(taskId) : null;
    if (turn == null) {
      turn = ChatTurn.assistant(taskId);
      session.turns.add(turn);
      if (turn.taskId != null) {
        _taskToSession.putIfAbsent(turn.taskId!, () => session!.id);
      }
    }
    session.activeTaskIds.remove(taskId);

    // Relay 断线补发会重复投递，按 fileId 去重
    if (turn.offers.any((o) => o.fileId == offer.fileId)) return;
    turn.offers.add(offer);
    turn.finished = true;
    if (turn.phase.isEmpty) turn.phase = '已完成';
  }

  ChatSession? _sessionForTask(String? taskId) {
    if (taskId == null) return null;
    final sid = _taskToSession[taskId];
    if (sid != null) {
      final found = _findSession(sid);
      if (found != null) return found;
    }
    // 兜底：在所有会话里找 turn（重载后 map 未重建时）
    for (final s in sessions) {
      if (s.turnForTask(taskId) != null) {
        _taskToSession[taskId] = s.id;
        return s;
      }
    }
    return null;
  }

  void _onMessage(Map<String, dynamic> msg) {
    final type = msg['type'] as String?;
    final p = msg['payload'] as Map<String, dynamic>? ?? {};

    if (type == 'file.offer') {
      _onFileOffer(p);
      notifyListeners();
      return;
    }

    if (type == 'agent.status') {
      final list = p['workspaces'] as List<dynamic>?;
      if (list != null && list.isNotEmpty) {
        workspaces = list
            .map((e) => {
                  'id': (e as Map)['id'] as String,
                  'name': e['name'] as String,
                })
            .toList();
        for (final s in sessions) {
          if (!workspaces.any((w) => w['id'] == s.workspaceId)) {
            s.workspaceId = workspaces.first['id']!;
          }
        }
      }

      var parsedModels = SessionStore.parseToolModelsMap(p['toolModels']);
      if (parsedModels.isEmpty) {
        final toolsMap = p['tools'];
        if (toolsMap is Map && toolsMap['__models_json'] is String) {
          try {
            parsedModels = SessionStore.parseToolModelsMap(
              jsonDecode(toolsMap['__models_json'] as String),
            );
          } catch (_) {}
        }
      }
      if (parsedModels.isNotEmpty) {
        toolModels = parsedModels;
        SessionStore.saveToolModelsCache(parsedModels);
      }

      var catalog = _parseCatalog(p['toolCatalog']);
      if (catalog.isEmpty) {
        final toolsMap = p['tools'];
        if (toolsMap is Map && toolsMap['__catalog_json'] is String) {
          try {
            catalog = _parseCatalog(jsonDecode(toolsMap['__catalog_json'] as String));
          } catch (_) {}
        }
      }
      if (catalog.isNotEmpty) {
        // 以 PC 上报的有效 CLI 为准，不再并回 App 里写死的列表
        toolCatalog = catalog;
        SessionStore.saveToolCatalogCache(catalog);
        _clampSessionToolsToVisible();
      }

      notifyListeners();
      return;
    }

    final taskId = p['taskId'] as String?;
    final session = _sessionForTask(taskId);
    if (session == null) {
      // 非本机会话的任务消息忽略
      if (taskId != null) return;
      return;
    }

    if (type == 'task.output' && taskId != null) {
      final text = p['text'] as String? ?? '';
      final kind = p['kind'] as String? ?? 'stdout';
      final seq = (p['seq'] as num?)?.toInt();
      final turn = session.turnForTask(taskId);
      if (turn != null) {
        if (seq != null) {
          // 全量回放：从 seq0 开始且本地尚未对齐时，清空旧 body 防重复
          if (seq == 0 && turn.lastSeq < 0 && turn.body.isNotEmpty) {
            turn.body = '';
          }
          if (seq <= turn.lastSeq) {
            notifyListeners();
            return;
          }
          turn.lastSeq = seq;
        }
        final piece = kind == 'markdown'
            ? sanitizeCliOutput(text)
            : parseModelOutputChunk(text);
        turn.body += piece;
        if (turn.body.isNotEmpty && !turn.finished) {
          turn.phase = '执行中';
        }
      }
    }

    if (type == 'task.confirm.request') {
      session.pendingConfirmTask = taskId;
      session.pendingConfirmId = p['confirmId'] as String?;
      session.pendingConfirmTitle = p['title'] as String?;
      session.turnForTask(taskId ?? '')?.phase = _phaseLabel('awaiting_confirm');
    }

    if (type == 'task.status' && taskId != null) {
      final status = p['status'] as String?;
      final turn = session.turnForTask(taskId);
      if (status != null && turn != null) {
        // catchup 回放 running 时不要盖住「停止中…」
        if (!(turn.phase == '停止中…' &&
            (status == 'running' || status == 'queued'))) {
          turn.phase = _phaseLabel(status);
        }
      }
      if (status == 'completed' ||
          status == 'failed' ||
          status == 'cancelled') {
        session.activeTaskIds.remove(taskId);
        if (turn != null && !turn.finished) {
          final m = p['message'] as String?;
          if (m != null && m.isNotEmpty) turn.body += '\n\n> $m\n';
          turn.finished = true;
          if (status == 'cancelled') turn.phase = '已停止';
        }
      }
    }

    notifyListeners();
  }
}
