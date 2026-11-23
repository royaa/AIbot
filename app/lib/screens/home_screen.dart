import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:uuid/uuid.dart';

import '../services/relay_client.dart';

class _ChatTurn {
  _ChatTurn.user(this.text) : isUser = true, taskId = null, body = text;

  _ChatTurn.assistant(this.taskId) : isUser = false, text = '', body = '';

  final bool isUser;
  final String text;
  final String? taskId;
  String body;
  bool finished = false;
  /// 任务阶段文案（显示在 PC 气泡顶部）
  String phase = '已发送到 Relay，等待 PC Agent…';
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.relayUrl, required this.client});

  final String relayUrl;
  final RelayClient client;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final promptCtrl = TextEditingController();
  final svnWorkDirCtrl = TextEditingController();
  final scrollCtrl = ScrollController();
  final turns = <_ChatTurn>[];
  String tool = 'auto';
  String workspaceId = 'grokbot';
  List<Map<String, String>> workspaces = [
    {'id': 'grokbot', 'name': 'AI Bot'},
  ];
  String? pendingConfirmTask;
  String? pendingConfirmId;
  String? pendingConfirmTitle;
  late final String _legacySessionId = const Uuid().v4();

  @override
  void initState() {
    super.initState();
    widget.client.onMessage = _onMessage;
    widget.client.onStateChanged = () {
      if (mounted) setState(() {});
    };
  }

  String _phaseLabel(String status) {
    switch (status) {
      case 'queued':
        return '已到达 Relay，排队中';
      case 'running':
        return 'PC Agent 正在执行';
      case 'awaiting_confirm':
        return '等待你在手机点「确认」';
      case 'completed':
        return '执行完成';
      case 'failed':
        return '执行失败';
      case 'cancelled':
        return '已取消';
      default:
        return status;
    }
  }

  void _updateTaskPhase(String? taskId, String status) {
    final t = taskId != null ? _turnForTask(taskId) : null;
    if (t != null) {
      t.phase = _phaseLabel(status);
    }
  }

  @override
  void dispose() {
    promptCtrl.dispose();
    svnWorkDirCtrl.dispose();
    scrollCtrl.dispose();
    super.dispose();
  }

  String? _normalizedSvnDir() {
    final d = svnWorkDirCtrl.text.trim().replaceAll('\\', '/');
    if (d.isEmpty) return null;
    return d.replaceAll(RegExp(r'^/+'), '');
  }

  Map<String, dynamic>? _svnOptions(String action) {
    final dir = _normalizedSvnDir();
    if (dir == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请先填写 SVN 子目录（相对下方 PC 工作区）')),
      );
      return null;
    }
    return {'svnAction': action, 'svnWorkDir': dir};
  }

  _ChatTurn? _turnForTask(String taskId) {
    for (var i = turns.length - 1; i >= 0; i--) {
      final t = turns[i];
      if (!t.isUser && t.taskId == taskId) return t;
    }
    return null;
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!scrollCtrl.hasClients) return;
      scrollCtrl.animateTo(
        scrollCtrl.position.maxScrollExtent,
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
      );
    });
  }

  void _onMessage(Map<String, dynamic> msg) {
    final type = msg['type'] as String?;
    final p = msg['payload'] as Map<String, dynamic>? ?? {};
    setState(() {
      if (type == 'agent.status') {
        final list = p['workspaces'] as List<dynamic>?;
        if (list != null) {
          workspaces = list
              .map((e) => {
                    'id': (e as Map)['id'] as String,
                    'name': e['name'] as String,
                  })
              .toList();
          if (!workspaces.any((w) => w['id'] == workspaceId)) {
            workspaceId = workspaces.first['id']!;
          }
        }
      }
      if (type == 'task.output') {
        final taskId = p['taskId'] as String?;
        final text = p['text'] as String? ?? '';
        if (taskId != null) {
          _turnForTask(taskId)?.body += text;
        }
      }
      if (type == 'task.confirm.request') {
        pendingConfirmTask = p['taskId'] as String?;
        pendingConfirmId = p['confirmId'] as String?;
        pendingConfirmTitle = p['title'] as String?;
        _updateTaskPhase(pendingConfirmTask, 'awaiting_confirm');
      }
      if (type == 'error') {
        final msg = p['message'] as String? ?? '错误';
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
      }
      if (type == 'task.status') {
        final taskId = p['taskId'] as String?;
        final status = p['status'] as String?;
        if (taskId != null && status != null) {
          _updateTaskPhase(taskId, status);
        }
        if (taskId != null &&
            (status == 'completed' || status == 'failed' || status == 'cancelled')) {
          final t = _turnForTask(taskId);
          if (t != null && !t.finished) {
            final msg = p['message'] as String?;
            if (msg != null && msg.isNotEmpty) {
              t.body += '\n\n> $msg\n';
            }
            t.body += '\n---\n';
            t.finished = true;
          }
        }
      }
    });
    _scrollToBottom();
  }

  String _dispatch({
    required String displayText,
    required String tool,
    required String prompt,
    Map<String, dynamic>? options,
  }) {
    final taskId = widget.client.sendTask(
      sessionId: _legacySessionId,
      workspaceId: workspaceId,
      tool: tool,
      prompt: prompt,
      options: options,
    );
    setState(() {
      turns.add(_ChatTurn.user(displayText));
      turns.add(_ChatTurn.assistant(taskId));
    });
    if (!widget.client.agentOnline) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('PC Agent 似乎未在线：请在本机运行 npm run agent'),
          duration: Duration(seconds: 4),
        ),
      );
    }
    Future.delayed(const Duration(seconds: 20), () {
      if (!mounted) return;
      final t = _turnForTask(taskId);
      if (t != null && !t.finished && t.body.isEmpty && t.phase.contains('等待')) {
        setState(() {
          t.phase = '超时：PC 未响应（检查 Agent 是否运行、是否配对）';
        });
      }
    });
    _scrollToBottom();
    return taskId;
  }

  void _send() {
    final text = promptCtrl.text.trim();
    if (text.isEmpty) return;
    promptCtrl.clear();
    FocusManager.instance.primaryFocus?.unfocus();
    Map<String, dynamic>? options;
    if (tool == 'svn') {
      final dir = _normalizedSvnDir();
      if (dir == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('使用 SVN 工具时请填写 SVN 子目录')),
        );
        return;
      }
      options = {'svnWorkDir': dir, 'svnAction': _inferSvnAction(text)};
    }
    _dispatch(displayText: text, tool: tool, prompt: text, options: options);
  }

  String _inferSvnAction(String text) {
    final p = text.toLowerCase();
    if (p.startsWith('commit') || p.startsWith('提交')) return 'commit';
    if (p.startsWith('update') || p.startsWith('更新')) return 'update';
    if (p.startsWith('diff') || p.startsWith('差异')) return 'diff';
    if (p.startsWith('log')) return 'log';
    return 'status';
  }

  Future<void> _svnCommitDialog() async {
    final logCtrl = TextEditingController();
    final dirCtrl = TextEditingController(text: svnWorkDirCtrl.text);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('SVN 提交'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: dirCtrl,
              decoration: const InputDecoration(
                labelText: 'SVN 子目录（相对 PC 工作区）',
                hintText: '如 www/myshop 或 admin',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: logCtrl,
              decoration: const InputDecoration(
                labelText: '提交说明',
                hintText: 'fix: 修复某某问题',
              ),
              maxLines: 3,
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('提交')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final msg = logCtrl.text.trim();
    final dir = dirCtrl.text.trim().replaceAll('\\', '/').replaceAll(RegExp(r'^/+'), '');
    logCtrl.dispose();
    dirCtrl.dispose();
    if (msg.isEmpty || dir.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('子目录与提交说明均不能为空')),
      );
      return;
    }
    svnWorkDirCtrl.text = dir;
    _dispatch(
      displayText: '[SVN 提交] $dir — $msg',
      tool: 'svn',
      prompt: msg,
      options: {'svnAction': 'commit', 'svnMessage': msg, 'svnWorkDir': dir},
    );
  }

  void _svnQuick(String label, String prompt, String action) {
    final options = _svnOptions(action);
    if (options == null) return;
    final dir = options['svnWorkDir'] as String;
    _dispatch(
      displayText: '[SVN] $label @ $dir',
      tool: 'svn',
      prompt: prompt,
      options: options,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AI Bot 遥控'),
        actions: [
          PopupMenuButton<String>(
            tooltip: 'SVN',
            icon: const Icon(Icons.source),
            onSelected: (v) {
              switch (v) {
                case 'commit':
                  _svnCommitDialog();
                  break;
                case 'status':
                  _svnQuick('查看状态', 'status', 'status');
                  break;
                case 'diff':
                  _svnQuick('查看差异', 'diff', 'diff');
                  break;
                case 'update':
                  _svnQuick('更新', 'update', 'update');
                  break;
              }
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'status', child: Text('查看状态（仅本次回复）')),
              PopupMenuItem(value: 'diff', child: Text('查看变更 diff')),
              PopupMenuItem(value: 'update', child: Text('svn update')),
              PopupMenuItem(value: 'commit', child: Text('提交（含状态与 diff）')),
            ],
          ),
          PopupMenuButton<String>(
            initialValue: tool,
            onSelected: (v) => setState(() => tool = v),
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'auto', child: Text('自动 (Grok)')),
              PopupMenuItem(value: 'grok', child: Text('Grok CLI')),
              PopupMenuItem(value: 'claude', child: Text('Claude CLI')),
              PopupMenuItem(value: 'cursor_agent', child: Text('Cursor Agent')),
              PopupMenuItem(value: 'dsh', child: Text('DeepSeek Harness')),
              PopupMenuItem(value: 'cursor', child: Text('Cursor 打开')),
              PopupMenuItem(value: 'svn', child: Text('SVN（指令解析）')),
            ],
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Center(child: Text('工具: $tool')),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          _ConnectionStatusBar(client: widget.client),
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 8, 8, 0),
            child: DropdownButtonFormField<String>(
              value: workspaceId,
              decoration: const InputDecoration(
                labelText: 'PC 工作区（大项目根，白名单）',
              ),
              items: workspaces
                  .map((w) => DropdownMenuItem(
                        value: w['id'],
                        child: Text(w['name'] ?? w['id']!),
                      ))
                  .toList(),
              onChanged: (v) => setState(() => workspaceId = v ?? workspaceId),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 4, 8, 0),
            child: TextField(
              controller: svnWorkDirCtrl,
              decoration: const InputDecoration(
                labelText: 'SVN 子目录（相对上面工作区，独立工作副本）',
                hintText: '例如 www/grokbot 或 shop-api',
                helperText: '大项目下每个 SVN 仓库填各自相对路径；所有 SVN 操作针对此目录',
                border: OutlineInputBorder(),
              ),
              textInputAction: TextInputAction.next,
            ),
          ),
          const SizedBox(height: 4),
          Expanded(
            child: turns.isEmpty
                ? const Center(child: Text('发送指令开始对话…'))
                : ListView.builder(
                    controller: scrollCtrl,
                    padding: const EdgeInsets.all(12),
                    itemCount: turns.length,
                    itemBuilder: (context, i) {
                      final t = turns[i];
                      final bg = t.isUser
                          ? Theme.of(context).colorScheme.primaryContainer
                          : Theme.of(context).colorScheme.surfaceContainerHighest;
                      final title = t.isUser ? '我' : 'PC';
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Material(
                          color: bg,
                          borderRadius: BorderRadius.circular(12),
                          child: Padding(
                            padding: const EdgeInsets.all(12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Text(title, style: Theme.of(context).textTheme.labelLarge),
                                    if (!t.isUser) ...[
                                      const SizedBox(width: 8),
                                      Expanded(
                                        child: Text(
                                          t.phase,
                                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                                color: t.finished
                                                    ? Colors.green.shade700
                                                    : Colors.orange.shade800,
                                              ),
                                        ),
                                      ),
                                    ],
                                  ],
                                ),
                                const SizedBox(height: 6),
                                MarkdownBody(
                                  data: t.isUser
                                      ? t.text
                                      : (t.body.isEmpty && !t.finished
                                          ? '_等待输出…_'
                                          : t.body),
                                  selectable: true,
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
          ),
          if (pendingConfirmId != null)
            MaterialBanner(
              content: Text(pendingConfirmTitle ?? '需要确认'),
              actions: [
                TextButton(
                  onPressed: () {
                    widget.client.confirm(
                      pendingConfirmTask!,
                      pendingConfirmId!,
                      false,
                    );
                    setState(() {
                      pendingConfirmId = null;
                      pendingConfirmTask = null;
                    });
                  },
                  child: const Text('拒绝'),
                ),
                FilledButton(
                  onPressed: () {
                    widget.client.confirm(
                      pendingConfirmTask!,
                      pendingConfirmId!,
                      true,
                    );
                    setState(() {
                      pendingConfirmId = null;
                      pendingConfirmTask = null;
                    });
                  },
                  child: const Text('确认'),
                ),
              ],
            ),
          Padding(
            padding: const EdgeInsets.all(8),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: promptCtrl,
                    decoration: const InputDecoration(
                      hintText: '输入指令…',
                      border: OutlineInputBorder(),
                    ),
                    minLines: 1,
                    maxLines: 4,
                    textInputAction: TextInputAction.send,
                    onSubmitted: (_) => _send(),
                  ),
                ),
                IconButton(onPressed: _send, icon: const Icon(Icons.send)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ConnectionStatusBar extends StatelessWidget {
  const _ConnectionStatusBar({required this.client});

  final RelayClient client;

  @override
  Widget build(BuildContext context) {
    final relayOk = client.relayConnected;
    final agentOk = client.agentOnline;
    Color c;
    String text;
    if (!relayOk) {
      c = Colors.red.shade100;
      text = 'Relay：未连接（检查 ws:// 地址与网络）';
    } else if (!agentOk) {
      c = Colors.orange.shade100;
      text = 'Relay：已连接 · PC Agent：未在线（请运行 npm run agent）';
    } else {
      c = Colors.green.shade100;
      text = 'Relay：已连接 · PC Agent：在线，可以下发指令';
    }
    return Material(
      color: c,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Text(text, style: Theme.of(context).textTheme.bodySmall),
      ),
    );
  }
}
