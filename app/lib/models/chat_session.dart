import 'package:uuid/uuid.dart';

import 'tool_catalog.dart';

/// Agent 推送到手机的文件（file.offer）
class FileOffer {
  FileOffer({
    required this.fileId,
    required this.name,
    required this.size,
    required this.mimeType,
    required this.sha256,
    required this.url,
    required this.expiresAt,
  });

  factory FileOffer.fromJson(Map<String, dynamic> j) {
    return FileOffer(
      fileId: j['fileId']?.toString() ?? '',
      name: j['name']?.toString() ?? 'file',
      size: (j['size'] as num?)?.toInt() ?? 0,
      mimeType: j['mimeType']?.toString() ?? 'application/octet-stream',
      sha256: j['sha256']?.toString() ?? '',
      url: j['url']?.toString() ?? '',
      expiresAt: (j['expiresAt'] as num?)?.toInt() ?? 0,
    );
  }

  final String fileId;
  final String name;
  final int size;
  final String mimeType;
  final String sha256;
  final String url;
  final int expiresAt;

  // ---- 以下为本地瞬态状态（不持久化） ----
  String status = 'idle'; // idle | downloading | done | error
  double progress = 0; // 0~1
  String? savedPath;
  String? error;

  Map<String, dynamic> toJson() => {
        'fileId': fileId,
        'name': name,
        'size': size,
        'mimeType': mimeType,
        'sha256': sha256,
        'url': url,
        'expiresAt': expiresAt,
      };

  bool get expired => expiresAt > 0 && DateTime.now().millisecondsSinceEpoch > expiresAt;

  String get sizeLabel {
    if (size >= 1024 * 1024 * 1024) {
      return '${(size / 1024 / 1024 / 1024).toStringAsFixed(2)}GB';
    }
    if (size >= 1024 * 1024) return '${(size / 1024 / 1024).toStringAsFixed(1)}MB';
    if (size >= 1024) return '${(size / 1024).toStringAsFixed(0)}KB';
    return '${size}B';
  }
}

class ChatTurn {
  ChatTurn.user(this.text) : isUser = true, taskId = null, body = text;

  ChatTurn.assistant(this.taskId) : isUser = false, text = '', body = '';

  final bool isUser;
  final String text;
  final String? taskId;
  String body;
  bool finished = false;
  String phase = '';
  /// 已收到的最大 task.output seq；-1 表示尚未收到或需全量 catchup
  int lastSeq = -1;
  /// 该回合推送过来的文件（APK 等）
  final List<FileOffer> offers = [];
}

class ChatSession {
  ChatSession({String? id, String? title})
      : id = id ?? const Uuid().v4(),
        title = title ?? '新会话',
        createdAt = DateTime.now();

  final String id;
  String title;
  final DateTime createdAt;
  String tool = 'auto';
  String workspaceId = 'grokbot';
  /// 按 CLI 工具名存储用户选定的模型
  final Map<String, String> selectedModels = {};
  final List<ChatTurn> turns = [];
  final Set<String> activeTaskIds = {};
  String? pendingConfirmTask;
  String? pendingConfirmId;
  String? pendingConfirmTitle;

  static String normalizeModelTool(String tool) =>
      tool == 'auto' ? 'claude' : tool;

  static bool supportsModelSelection(
    String tool, {
    List<ToolCatalogEntry>? catalog,
  }) {
    final list = catalog ?? defaultToolCatalog;
    final key = normalizeModelTool(tool);
    for (final e in list) {
      if (e.id == key) return e.supportsModels;
    }
    return key == 'claude' || key == 'cursor_agent' || key == 'codex';
  }

  /// 旧会话 / 已下架 / 动作类工具 → 映射到 auto；合法对话 CLI 原样保留
  static String sanitizeTool(
    String? tool, {
    List<ToolCatalogEntry>? catalog,
  }) {
    final t = tool?.trim() ?? '';
    if (t.isEmpty || t == 'file' || t == 'svn' || t == 'cursor') {
      return 'auto';
    }
    final list = catalog ?? defaultToolCatalog;
    ToolCatalogEntry? entry;
    for (final e in list) {
      if (e.id == t) {
        entry = e;
        break;
      }
    }
    if (entry == null) {
      for (final e in defaultToolCatalog) {
        if (e.id == t) {
          entry = e;
          break;
        }
      }
    }
    if (entry != null) {
      return entry.chatSelectable ? t : 'auto';
    }
    return 'auto';
  }

  String? selectedModelFor(
    String tool, {
    List<ToolCatalogEntry>? catalog,
  }) {
    if (!supportsModelSelection(tool, catalog: catalog)) return null;
    final v = selectedModels[normalizeModelTool(tool)]?.trim();
    return (v == null || v.isEmpty) ? null : v;
  }

  void setSelectedModel(
    String tool,
    String? modelId, {
    List<ToolCatalogEntry>? catalog,
  }) {
    if (!supportsModelSelection(tool, catalog: catalog)) return;
    final key = normalizeModelTool(tool);
    final v = modelId?.trim() ?? '';
    if (v.isEmpty) {
      selectedModels.remove(key);
    } else {
      selectedModels[key] = v;
    }
  }

  int get runningCount =>
      turns.where((t) => !t.isUser && !t.finished && t.taskId != null).length;

  ChatTurn? turnForTask(String taskId) {
    for (var i = turns.length - 1; i >= 0; i--) {
      final t = turns[i];
      if (!t.isUser && t.taskId == taskId) return t;
    }
    return null;
  }
}
