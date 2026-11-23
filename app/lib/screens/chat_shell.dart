import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:google_fonts/google_fonts.dart';

import '../models/chat_session.dart';
import '../models/tool_catalog.dart';
import '../services/chat_hub.dart';
import '../services/file_service.dart';
import '../services/relay_client.dart';
import '../theme/app_theme.dart';
import '../utils/output_parser.dart';
import 'settings_screen.dart';

class ChatShell extends StatefulWidget {
  const ChatShell({super.key, required this.relayUrl, required this.client});

  final String relayUrl;
  final RelayClient client;

  @override
  State<ChatShell> createState() => _ChatShellState();
}

class _ChatShellState extends State<ChatShell> {
  ChatHub? chatHub;
  late final Future<ChatHub> _chatHubFuture = ChatHub.create(widget.client);
  final promptCtrl = TextEditingController();
  final scrollCtrl = ScrollController();
  bool _stickToBottom = true;
  static const double _stickThreshold = 96;
  String? _trackedSessionId;
  final List<Map<String, String>> _pendingAttachments = [];

  @override
  void initState() {
    super.initState();
    scrollCtrl.addListener(_onScroll);
    widget.client.onStateChanged = () {
      if (mounted) setState(() {});
    };
    _chatHubFuture.then((h) {
      chatHub = h;
      h.addListener(_onHub);
      if (mounted) setState(() {});
    });
  }

  void _onScroll() {
    if (!scrollCtrl.hasClients) return;
    final pos = scrollCtrl.position;
    final atBottom = pos.pixels >= pos.maxScrollExtent - _stickThreshold;
    if (atBottom != _stickToBottom) {
      setState(() => _stickToBottom = atBottom);
    }
  }

  void _onHub() {
    if (mounted) setState(() {});
    final sid = chatHub?.currentSessionId;
    final switched = sid != null && sid != _trackedSessionId;
    _trackedSessionId = sid;
    _scrollToBottom(force: switched);
  }

  @override
  void dispose() {
    chatHub?.removeListener(_onHub);
    scrollCtrl.removeListener(_onScroll);
    promptCtrl.dispose();
    scrollCtrl.dispose();
    super.dispose();
  }

  ChatSession get session {
    final h = chatHub;
    if (h == null) throw StateError('chatHub loading');
    return h.current;
  }

  void _openSettings(ChatHub hub) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => SettingsScreen(
          client: widget.client,
          chatHub: hub,
        ),
      ),
    );
  }

  void _scrollToBottom({bool force = false}) {
    if (!force && !_stickToBottom) return;
    if (force && !_stickToBottom) {
      if (mounted) {
        setState(() => _stickToBottom = true);
      } else {
        _stickToBottom = true;
      }
    } else if (force) {
      _stickToBottom = true;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!scrollCtrl.hasClients) return;
      final target = scrollCtrl.position.maxScrollExtent;
      if ((scrollCtrl.position.pixels - target).abs() < 1) return;
      scrollCtrl.jumpTo(target);
    });
  }

  Future<void> _pickImage() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.image,
      withData: true,
      allowMultiple: true,
    );
    if (result == null || !mounted) return;
    setState(() {
      for (final f in result.files) {
        final bytes = f.bytes;
        if (bytes == null) continue;
        final name = f.name;
        final ext =
            name.contains('.') ? name.split('.').last.toLowerCase() : 'jpg';
        final mime = switch (ext) {
          'png' => 'image/png',
          'gif' => 'image/gif',
          'webp' => 'image/webp',
          _ => 'image/jpeg',
        };
        _pendingAttachments.add({
          'name': name,
          'mimeType': mime,
          'dataBase64': base64Encode(bytes),
        });
      }
    });
  }

  void _send() {
    final text = promptCtrl.text.trim();
    if (text.isEmpty && _pendingAttachments.isEmpty) return;
    promptCtrl.clear();
    FocusManager.instance.primaryFocus?.unfocus();
    Map<String, dynamic>? options;
    final tool = ChatSession.sanitizeTool(
      session.tool,
      catalog: chatHub?.toolCatalog,
    );
    if (session.tool != tool) {
      chatHub!.setSessionTool(session.id, tool);
    }
    final selectedModel = session.selectedModelFor(
      tool,
      catalog: chatHub?.toolCatalog,
    );
    if (selectedModel != null) {
      options = {
        ...?options,
        'model': selectedModel,
      };
    }
    if (_pendingAttachments.isNotEmpty) {
      options = {
        ...?options,
        'attachments': _pendingAttachments
            .map((a) => {
                  'name': a['name'],
                  'mimeType': a['mimeType'],
                  'dataBase64': a['dataBase64'],
                })
            .toList(),
      };
    }
    var displayText = text;
    if (displayText.isEmpty) {
      displayText =
          '[图片] ${_pendingAttachments.map((a) => a['name']).join(', ')}';
    } else if (_pendingAttachments.isNotEmpty) {
      displayText = '$displayText\n[图片×${_pendingAttachments.length}]';
    }
    final prompt = text.isEmpty ? '请描述并分析用户上传的图片。' : text;
    chatHub!.send(
      sessionId: session.id,
      displayText: displayText,
      tool: tool,
      prompt: prompt,
      options: options,
    );
    setState(() => _pendingAttachments.clear());
    _scrollToBottom(force: true);
  }

  Future<void> _openModelPicker(ChatHub hub, ChatSession s) async {
    final models = hub.modelsForTool(s.tool);
    if (models.isEmpty) return;
    final currentModel = s.selectedModelFor(s.tool, catalog: hub.toolCatalog);
    final chosen = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.surface,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => _ModelPickerSheet(
        toolTitle: hub.toolLabel(s.tool),
        models: models,
        currentModelId: currentModel,
      ),
    );
    if (chosen == null || !mounted) return;
    hub.setSessionModel(s.id, s.tool, chosen == '__default__' ? null : chosen);
  }

  Future<void> _renameSession(ChatHub hub, ChatSession s) async {
    final ctrl = TextEditingController(text: s.title);
    final next = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text(
          '修改会话名称',
          style: GoogleFonts.plusJakartaSans(
            fontSize: 17,
            fontWeight: FontWeight.w600,
          ),
        ),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          maxLength: 40,
          textInputAction: TextInputAction.done,
          onSubmitted: (v) => Navigator.pop(ctx, v.trim()),
          decoration: const InputDecoration(
            labelText: '名称',
            counterText: '',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, ctrl.text.trim()),
            child: const Text('保存'),
          ),
        ],
      ),
    );
    ctrl.dispose();
    if (next == null || next.isEmpty || !mounted) return;
    hub.renameSession(s.id, next);
  }

  Future<void> _pickWorkspace(ChatHub hub, ChatSession s) async {
    if (hub.workspaces.length <= 1) return;
    final chosen = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.surface,
      showDragHandle: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
              child: Text(
                'PC 工作区',
                style: GoogleFonts.plusJakartaSans(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            for (final w in hub.workspaces)
              ListTile(
                title: Text(w['name'] ?? w['id']!),
                trailing: s.workspaceId == w['id']
                    ? const Icon(Icons.check, color: AppColors.accent, size: 20)
                    : null,
                onTap: () => Navigator.pop(ctx, w['id']),
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (chosen != null) hub.setSessionWorkspace(s.id, chosen);
  }

  String _statusHint() {
    final c = widget.client;
    if (c.relayConnected && c.agentOnline) return 'PC Agent 在线';
    if (c.relayConnected) return 'Relay 已连 · Agent 离线';
    return '未连接';
  }

  @override
  Widget build(BuildContext context) {
    if (chatHub == null) {
      return Scaffold(
        backgroundColor: AppColors.bg,
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(
                width: 28,
                height: 28,
                child: CircularProgressIndicator(strokeWidth: 2.4),
              ),
              const SizedBox(height: 16),
              Text(
                '加载会话…',
                style: GoogleFonts.plusJakartaSans(color: AppColors.muted),
              ),
            ],
          ),
        ),
      );
    }
    final hub = chatHub!;
    final running = session.runningCount;
    String workspaceName = session.workspaceId;
    for (final w in hub.workspaces) {
      if (w['id'] == session.workspaceId) {
        workspaceName = w['name'] ?? w['id']!;
        break;
      }
    }
    final showModels = ChatSession.supportsModelSelection(
          session.tool,
          catalog: hub.toolCatalog,
        ) &&
        hub.modelsForTool(session.tool).isNotEmpty;
    final modelLabel = hub.modelLabelFor(
      session.tool,
      session.selectedModelFor(session.tool, catalog: hub.toolCatalog),
    );

    return Scaffold(
      backgroundColor: AppColors.bg,
      drawer: _SessionDrawer(
        chatHub: hub,
        client: widget.client,
        onOpenSettings: () => _openSettings(hub),
        onRename: (s) => _renameSession(hub, s),
      ),
      appBar: AppBar(
        titleSpacing: 0,
        title: Row(
          children: [
            Flexible(
              child: InkWell(
                onTap: () => _renameSession(hub, session),
                borderRadius: BorderRadius.circular(8),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Flexible(
                        child: Text(
                          session.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 4),
                      const Icon(
                        Icons.edit_outlined,
                        size: 15,
                        color: AppColors.muted,
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(width: 10),
            _StatusDot(
              client: widget.client,
              tooltip: _statusHint(),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: '设置',
            icon: const Icon(Icons.settings_outlined, size: 22),
            onPressed: () => _openSettings(hub),
          ),
          IconButton(
            tooltip: '新会话',
            icon: const Icon(Icons.edit_square, size: 22),
            onPressed: () {
              hub.newSession();
              _scrollToBottom(force: true);
            },
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 220),
              switchInCurve: Curves.easeOut,
              switchOutCurve: Curves.easeIn,
              child: KeyedSubtree(
                key: ValueKey(session.id),
                child: Stack(
                  children: [
                    _MessageList(
                      session: session,
                      scrollCtrl: scrollCtrl,
                      relayUrl: widget.relayUrl,
                    ),
                    if (!_stickToBottom && session.turns.isNotEmpty)
                      Positioned(
                        right: 16,
                        bottom: 12,
                        child: Material(
                          color: AppColors.surface,
                          elevation: 1,
                          shadowColor: Colors.black26,
                          shape: const CircleBorder(),
                          child: InkWell(
                            customBorder: const CircleBorder(),
                            onTap: () => _scrollToBottom(force: true),
                            child: const SizedBox(
                              width: 40,
                              height: 40,
                              child: Icon(
                                Icons.keyboard_arrow_down_rounded,
                                color: AppColors.ink,
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
          if (session.pendingConfirmId != null)
            _ConfirmBar(
              title: session.pendingConfirmTitle ?? '需要确认',
              onReject: () {
                widget.client.confirm(
                  session.pendingConfirmTask!,
                  session.pendingConfirmId!,
                  false,
                );
                setState(() {
                  session.pendingConfirmId = null;
                  session.pendingConfirmTask = null;
                });
              },
              onApprove: () {
                widget.client.confirm(
                  session.pendingConfirmTask!,
                  session.pendingConfirmId!,
                  true,
                );
                setState(() {
                  session.pendingConfirmId = null;
                  session.pendingConfirmTask = null;
                });
              },
            ),
          _Composer(
            controller: promptCtrl,
            running: running > 0,
            onSend: _send,
            onStop: () => hub.cancelRunningInSession(session.id),
            onPickImage: _pickImage,
            attachments: _pendingAttachments,
            onRemoveAttachment: (i) =>
                setState(() => _pendingAttachments.removeAt(i)),
            toolName: hub.toolLabel(session.tool),
            primaryTools: hub.primaryTools,
            onSelectTool: (t) => hub.setSessionTool(session.id, t),
            showModels: showModels,
            modelLabel: modelLabel,
            onTapModel: () => _openModelPicker(hub, session),
            showWorkspace: hub.workspaces.length > 1,
            workspaceName: workspaceName,
            onTapWorkspace: () => _pickWorkspace(hub, session),
            currentTool: session.tool,
          ),
        ],
      ),
    );
  }
}

class _StatusDot extends StatefulWidget {
  const _StatusDot({
    required this.client,
    required this.tooltip,
  });

  final RelayClient client;
  final String tooltip;

  @override
  State<_StatusDot> createState() => _StatusDotState();
}

class _StatusDotState extends State<_StatusDot>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse;

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  Color get _color {
    final c = widget.client;
    if (c.relayConnected && c.agentOnline) return AppColors.online;
    if (c.relayConnected) return AppColors.relayOnly;
    return AppColors.offline;
  }

  @override
  Widget build(BuildContext context) {
    final online =
        widget.client.relayConnected && widget.client.agentOnline;
    return Tooltip(
      message: '${widget.tooltip}\n连接相关操作请到设置',
      child: Padding(
        padding: const EdgeInsets.all(6),
        child: AnimatedBuilder(
          animation: _pulse,
          builder: (context, _) {
            final scale = online ? 1 + (_pulse.value * 0.12) : 1.0;
            return Transform.scale(
              scale: scale,
              child: Container(
                width: 9,
                height: 9,
                decoration: BoxDecoration(
                  color: _color,
                  shape: BoxShape.circle,
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

class _SessionDrawer extends StatelessWidget {
  const _SessionDrawer({
    required this.chatHub,
    required this.client,
    required this.onOpenSettings,
    required this.onRename,
  });

  final ChatHub chatHub;
  final RelayClient client;
  final VoidCallback onOpenSettings;
  final Future<void> Function(ChatSession session) onRename;

  @override
  Widget build(BuildContext context) {
    final status = client.relayConnected && client.agentOnline
        ? 'PC Agent 在线'
        : client.relayConnected
            ? 'Relay 已连 · Agent 离线'
            : '未连接 Relay';

    return Drawer(
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'AI Bot',
                    style: GoogleFonts.plusJakartaSans(
                      fontSize: 22,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                      letterSpacing: -0.4,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '会话',
                    style: GoogleFonts.plusJakartaSans(
                      fontSize: 13,
                      color: AppColors.muted,
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView.builder(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                itemCount: chatHub.sessions.length,
                itemBuilder: (context, i) {
                  final s = chatHub.sessions[i];
                  final selected = s.id == chatHub.currentSessionId;
                  final run = s.runningCount;
                  return ListTile(
                    selected: selected,
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 2,
                    ),
                    title: Text(
                      s.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: GoogleFonts.plusJakartaSans(
                        fontWeight:
                            selected ? FontWeight.w600 : FontWeight.w500,
                        fontSize: 14.5,
                      ),
                    ),
                    subtitle: run > 0
                        ? Text(
                            '$run 进行中',
                            style: GoogleFonts.plusJakartaSans(
                              fontSize: 12,
                              color: AppColors.accent,
                            ),
                          )
                        : null,
                    leading: run > 0
                        ? const Padding(
                            padding: EdgeInsets.only(top: 4),
                            child: Icon(
                              Icons.circle,
                              size: 8,
                              color: AppColors.accent,
                            ),
                          )
                        : const SizedBox(width: 8),
                    onTap: () {
                      chatHub.switchSession(s.id);
                      Navigator.pop(context);
                    },
                    onLongPress: () => onRename(s),
                    trailing: PopupMenuButton<String>(
                      tooltip: '更多',
                      icon: const Icon(Icons.more_horiz, size: 20),
                      color: AppColors.surface,
                      onSelected: (v) async {
                        if (v == 'rename') {
                          await onRename(s);
                        } else if (v == 'delete') {
                          chatHub.deleteSession(s.id);
                        }
                      },
                      itemBuilder: (_) => [
                        const PopupMenuItem(
                          value: 'rename',
                          child: Text('重命名'),
                        ),
                        if (chatHub.sessions.length > 1)
                          const PopupMenuItem(
                            value: 'delete',
                            child: Text('删除'),
                          ),
                      ],
                    ),
                  );
                },
              ),
            ),
            const Divider(height: 1, color: AppColors.divider),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: Text(
                status,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: GoogleFonts.plusJakartaSans(
                  fontSize: 12.5,
                  color: AppColors.muted,
                ),
              ),
            ),
            ListTile(
              leading: const Icon(Icons.settings_outlined, size: 22),
              title: Text(
                '设置',
                style: GoogleFonts.plusJakartaSans(
                  fontSize: 14.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
              subtitle: Text(
                '对话 CLI · 重连 · 重新配对',
                style: GoogleFonts.plusJakartaSans(
                  fontSize: 12,
                  color: AppColors.muted,
                ),
              ),
              onTap: () {
                Navigator.pop(context);
                onOpenSettings();
              },
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
              child: FilledButton.icon(
                onPressed: () {
                  chatHub.newSession();
                  Navigator.pop(context);
                },
                icon: const Icon(Icons.add, size: 18),
                label: const Text('新建会话'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MessageList extends StatelessWidget {
  const _MessageList({
    required this.session,
    required this.scrollCtrl,
    required this.relayUrl,
  });

  final ChatSession session;
  final ScrollController scrollCtrl;
  final String relayUrl;

  @override
  Widget build(BuildContext context) {
    if (session.turns.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 40),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'AI Bot',
                style: GoogleFonts.plusJakartaSans(
                  fontSize: 28,
                  fontWeight: FontWeight.w700,
                  color: AppColors.ink,
                  letterSpacing: -0.6,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                '给 PC Agent 下一条指令即可开始',
                textAlign: TextAlign.center,
                style: GoogleFonts.plusJakartaSans(
                  fontSize: 14.5,
                  height: 1.45,
                  color: AppColors.muted,
                ),
              ),
            ],
          ),
        ),
      );
    }
    return ListView.builder(
      controller: scrollCtrl,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
      itemCount: session.turns.length,
      itemBuilder: (context, i) =>
          _Bubble(turn: session.turns[i], relayUrl: relayUrl),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.turn, required this.relayUrl});

  final ChatTurn turn;
  final String relayUrl;

  MarkdownStyleSheet _mdSheet(BuildContext context) {
    final body = GoogleFonts.sourceSerif4(
      fontSize: 15.5,
      height: 1.55,
      color: AppColors.ink,
    );
    final ui = GoogleFonts.plusJakartaSans(
      fontSize: 14,
      height: 1.45,
      color: AppColors.ink,
    );
    return MarkdownStyleSheet(
      p: body,
      h1: GoogleFonts.sourceSerif4(
        fontSize: 22,
        fontWeight: FontWeight.w700,
        color: AppColors.ink,
        height: 1.3,
      ),
      h2: GoogleFonts.sourceSerif4(
        fontSize: 19,
        fontWeight: FontWeight.w700,
        color: AppColors.ink,
        height: 1.3,
      ),
      h3: GoogleFonts.sourceSerif4(
        fontSize: 17,
        fontWeight: FontWeight.w600,
        color: AppColors.ink,
        height: 1.35,
      ),
      strong: body.copyWith(fontWeight: FontWeight.w700),
      em: body.copyWith(fontStyle: FontStyle.italic),
      listBullet: body,
      blockquote: body.copyWith(color: AppColors.muted),
      blockquoteDecoration: const BoxDecoration(
        border: Border(
          left: BorderSide(color: AppColors.divider, width: 3),
        ),
      ),
      code: GoogleFonts.jetBrainsMono(
        fontSize: 13,
        color: AppColors.ink,
        backgroundColor: AppColors.codeBg,
      ),
      codeblockDecoration: BoxDecoration(
        color: AppColors.codeBg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.divider),
      ),
      codeblockPadding: const EdgeInsets.all(12),
      a: ui.copyWith(
        color: AppColors.accent,
        decoration: TextDecoration.underline,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isUser = turn.isUser;
    if (isUser) {
      return Align(
        alignment: Alignment.centerRight,
        child: Container(
          constraints: BoxConstraints(
            maxWidth: MediaQuery.sizeOf(context).width * 0.82,
          ),
          margin: const EdgeInsets.only(bottom: 14),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
          decoration: BoxDecoration(
            color: AppColors.userBubble,
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(18),
              topRight: Radius.circular(18),
              bottomLeft: Radius.circular(18),
              bottomRight: Radius.circular(6),
            ),
          ),
          child: MarkdownBody(
            data: turn.text,
            selectable: true,
            styleSheet: MarkdownStyleSheet(
              p: GoogleFonts.plusJakartaSans(
                fontSize: 15,
                height: 1.45,
                color: AppColors.ink,
              ),
            ),
          ),
        ),
      );
    }

    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width * 0.94,
        ),
        margin: const EdgeInsets.only(bottom: 18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (turn.phase.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 6, left: 2),
                child: Text(
                  turn.phase,
                  style: GoogleFonts.plusJakartaSans(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                    letterSpacing: 0.2,
                    color: turn.finished && turn.phase == '已完成'
                        ? AppColors.accent
                        : AppColors.muted,
                  ),
                ),
              ),
            if (turn.body.isEmpty && !turn.finished)
              Padding(
                padding: const EdgeInsets.only(left: 2, top: 2),
                child: Text(
                  '…',
                  style: GoogleFonts.sourceSerif4(
                    fontSize: 18,
                    color: AppColors.muted,
                  ),
                ),
              ),
            if (turn.body.isNotEmpty)
              MarkdownBody(
                data: sanitizeCliOutput(turn.body),
                selectable: true,
                styleSheet: _mdSheet(context),
              ),
            for (final offer in turn.offers)
              _FileOfferCard(offer: offer, relayUrl: relayUrl),
          ],
        ),
      ),
    );
  }
}

/// PC 推送文件：默认只展示可点链接，用户点击后才下载。
class _FileOfferCard extends StatefulWidget {
  const _FileOfferCard({required this.offer, required this.relayUrl});

  final FileOffer offer;
  final String relayUrl;

  @override
  State<_FileOfferCard> createState() => _FileOfferCardState();
}

class _FileOfferCardState extends State<_FileOfferCard> {
  FileService? _svc;
  bool _opening = false;

  @override
  void initState() {
    super.initState();
    // 只初始化服务 / 探测本地是否已有文件；不自动开始下载
    _init();
  }

  Future<void> _init() async {
    final svc = await FileService.instance(widget.relayUrl);
    if (!mounted) return;
    setState(() {
      _svc = svc;
      final saved = svc.savedPathOf(widget.offer);
      if (saved != null && widget.offer.status != 'downloading') {
        widget.offer.status = 'done';
        widget.offer.savedPath = saved;
      } else if (widget.offer.status == 'downloading') {
        // 异常残留态：回到 idle，等用户再点
        widget.offer.status = 'idle';
        widget.offer.progress = 0;
      }
    });
  }

  String get _downloadUrl =>
      '${FileService.httpBaseFromWs(widget.relayUrl)}${widget.offer.url}';

  Future<void> _download() async {
    if (widget.offer.expired) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('链接已过期，请在 PC 重新推送')),
      );
      return;
    }
    var svc = _svc;
    svc ??= await FileService.instance(widget.relayUrl);
    if (!mounted) return;
    _svc = svc;
    setState(() {
      widget.offer.status = 'downloading';
      widget.offer.error = null;
      widget.offer.progress = 0;
    });
    try {
      final path = await svc.download(
        widget.offer,
        onProgress: (p) {
          if (mounted) setState(() => widget.offer.progress = p);
        },
      );
      if (!mounted) return;
      setState(() {
        widget.offer.status = 'done';
        widget.offer.savedPath = path;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        widget.offer.status = 'error';
        widget.offer.error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _open() async {
    final path = widget.offer.savedPath;
    if (path == null) return;
    setState(() => _opening = true);
    final err = await FileService.openLocal(path);
    if (!mounted) return;
    setState(() => _opening = false);
    if (err.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final o = widget.offer;
    final downloading = o.status == 'downloading';
    final done = o.status == 'done' && o.savedPath != null;
    final idleOrError = !downloading && !done;

    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${o.name}（${o.sizeLabel}）',
            style: GoogleFonts.plusJakartaSans(
              fontSize: 13.5,
              fontWeight: FontWeight.w600,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 4),
          if (idleOrError) ...[
            InkWell(
              onTap: o.expired ? null : _download,
              child: Text(
                o.expired ? '链接已过期' : _downloadUrl,
                style: GoogleFonts.plusJakartaSans(
                  fontSize: 12.5,
                  height: 1.35,
                  color: o.expired ? AppColors.muted : AppColors.accent,
                  decoration:
                      o.expired ? null : TextDecoration.underline,
                  decorationColor: AppColors.accent,
                ),
              ),
            ),
            const SizedBox(height: 2),
            Text(
              o.status == 'error'
                  ? '点击上方链接重试下载'
                  : '点击上方链接开始下载（不会自动下载）',
              style: GoogleFonts.plusJakartaSans(
                fontSize: 11,
                color: AppColors.muted,
              ),
            ),
          ],
          if (downloading) ...[
            Row(
              children: [
                SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    value: o.progress > 0 ? o.progress : null,
                    valueColor:
                        const AlwaysStoppedAnimation(AppColors.accent),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '下载中 ${(o.progress * 100).toStringAsFixed(0)}%',
                    style: GoogleFonts.plusJakartaSans(
                      fontSize: 12.5,
                      color: AppColors.muted,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: o.progress > 0 ? o.progress : null,
                minHeight: 3,
                backgroundColor: AppColors.divider,
                valueColor: const AlwaysStoppedAnimation(AppColors.accent),
              ),
            ),
          ],
          if (done) ...[
            Text(
              '已保存到本机',
              style: GoogleFonts.plusJakartaSans(
                fontSize: 12,
                color: AppColors.muted,
              ),
            ),
            const SizedBox(height: 4),
            TextButton(
              style: TextButton.styleFrom(
                visualDensity: VisualDensity.compact,
                padding: EdgeInsets.zero,
                minimumSize: const Size(0, 28),
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              onPressed: _opening ? null : _open,
              child: Text(
                _opening ? '打开中…' : '打开 / 安装',
                style: GoogleFonts.plusJakartaSans(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                  color: AppColors.accent,
                ),
              ),
            ),
          ],
          if (o.status == 'error' && o.error != null) ...[
            const SizedBox(height: 4),
            Text(
              o.error!,
              style: GoogleFonts.plusJakartaSans(
                fontSize: 11.5,
                color: AppColors.stop,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ConfirmBar extends StatelessWidget {
  const _ConfirmBar({
    required this.title,
    required this.onReject,
    required this.onApprove,
  });

  final String title;
  final VoidCallback onReject;
  final VoidCallback onApprove;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.divider)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              title,
              style: GoogleFonts.plusJakartaSans(
                fontSize: 14,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          TextButton(onPressed: onReject, child: const Text('拒绝')),
          const SizedBox(width: 4),
          FilledButton(onPressed: onApprove, child: const Text('确认')),
        ],
      ),
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.running,
    required this.onSend,
    required this.onStop,
    required this.onPickImage,
    required this.attachments,
    required this.onRemoveAttachment,
    required this.toolName,
    required this.primaryTools,
    required this.onSelectTool,
    required this.showModels,
    required this.modelLabel,
    required this.onTapModel,
    required this.showWorkspace,
    required this.workspaceName,
    required this.onTapWorkspace,
    required this.currentTool,
  });

  final TextEditingController controller;
  final bool running;
  final VoidCallback onSend;
  final VoidCallback onStop;
  final VoidCallback onPickImage;
  final List<Map<String, String>> attachments;
  final void Function(int index) onRemoveAttachment;
  final String toolName;
  final List<ToolCatalogEntry> primaryTools;
  final ValueChanged<String> onSelectTool;
  final bool showModels;
  final String modelLabel;
  final VoidCallback onTapModel;
  final bool showWorkspace;
  final String workspaceName;
  final VoidCallback onTapWorkspace;
  final String currentTool;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.bg,
        border: Border(top: BorderSide(color: AppColors.divider)),
      ),
      padding: EdgeInsets.fromLTRB(
        12,
        8,
        12,
        MediaQuery.paddingOf(context).bottom + 10,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _ToolStrip(
            toolName: toolName,
            primaryTools: primaryTools,
            onSelectTool: onSelectTool,
            showModels: showModels,
            modelLabel: modelLabel,
            onTapModel: onTapModel,
            showWorkspace: showWorkspace,
            workspaceName: workspaceName,
            onTapWorkspace: onTapWorkspace,
            currentTool: currentTool,
          ),
          if (attachments.isNotEmpty) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 4,
              children: [
                for (var i = 0; i < attachments.length; i++)
                  InputChip(
                    label: Text(
                      attachments[i]['name'] ?? '图片',
                      overflow: TextOverflow.ellipsis,
                    ),
                    onDeleted: () => onRemoveAttachment(i),
                    side: const BorderSide(color: AppColors.divider),
                    backgroundColor: AppColors.surface,
                    visualDensity: VisualDensity.compact,
                  ),
              ],
            ),
          ],
          const SizedBox(height: 8),
          Container(
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: AppColors.divider),
            ),
            padding: const EdgeInsets.fromLTRB(4, 4, 6, 4),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                IconButton(
                  onPressed: onPickImage,
                  tooltip: '上传图片',
                  icon: const Icon(Icons.image_outlined, size: 22),
                  color: AppColors.muted,
                ),
                Expanded(
                  child: TextField(
                    controller: controller,
                    minLines: 1,
                    maxLines: 5,
                    textInputAction:
                        running ? TextInputAction.none : TextInputAction.send,
                    onSubmitted: running ? null : (_) => onSend(),
                    style: GoogleFonts.plusJakartaSans(
                      fontSize: 15,
                      height: 1.4,
                      color: AppColors.ink,
                    ),
                    decoration: InputDecoration(
                      hintText:
                          running ? '生成中，点右侧停止' : '给 PC Agent 下指令…',
                      filled: false,
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 4,
                        vertical: 12,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 4),
                AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  curve: Curves.easeOut,
                  child: Material(
                    color: running ? AppColors.stop : AppColors.accent,
                    shape: const CircleBorder(),
                    child: InkWell(
                      customBorder: const CircleBorder(),
                      onTap: running ? onStop : onSend,
                      child: SizedBox(
                        width: 42,
                        height: 42,
                        child: Icon(
                          running
                              ? Icons.stop_rounded
                              : Icons.arrow_upward_rounded,
                          color: Colors.white,
                          size: 22,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ToolStrip extends StatelessWidget {
  const _ToolStrip({
    required this.toolName,
    required this.primaryTools,
    required this.onSelectTool,
    required this.showModels,
    required this.modelLabel,
    required this.onTapModel,
    required this.showWorkspace,
    required this.workspaceName,
    required this.onTapWorkspace,
    required this.currentTool,
  });

  final String toolName;
  final List<ToolCatalogEntry> primaryTools;
  final ValueChanged<String> onSelectTool;
  final bool showModels;
  final String modelLabel;
  final VoidCallback onTapModel;
  final bool showWorkspace;
  final String workspaceName;
  final VoidCallback onTapWorkspace;
  final String currentTool;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          PopupMenuButton<String>(
            initialValue: currentTool,
            onSelected: onSelectTool,
            tooltip: '选择 CLI',
            itemBuilder: (_) => [
              for (final t in primaryTools)
                PopupMenuItem(
                  value: t.id,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(t.label),
                      Text(
                        t.capabilityNote?.isNotEmpty == true
                            ? '${t.hostKindLabel} · ${t.capabilityNote}'
                            : t.hostKindLabel,
                        style: GoogleFonts.plusJakartaSans(
                          fontSize: 11,
                          color: AppColors.muted,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
            child: _StripLabel(text: toolName),
          ),
          if (showModels) ...[
            _dot(),
            InkWell(
              onTap: onTapModel,
              borderRadius: BorderRadius.circular(8),
              child: _StripLabel(text: modelLabel),
            ),
          ],
          if (showWorkspace) ...[
            _dot(),
            InkWell(
              onTap: onTapWorkspace,
              borderRadius: BorderRadius.circular(8),
              child: _StripLabel(text: workspaceName),
            ),
          ],
        ],
      ),
    );
  }

  Widget _dot() => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6),
        child: Text(
          '·',
          style: GoogleFonts.plusJakartaSans(
            color: AppColors.muted,
            fontSize: 16,
            fontWeight: FontWeight.w600,
          ),
        ),
      );
}

class _StripLabel extends StatelessWidget {
  const _StripLabel({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
      child: Text(
        text,
        style: GoogleFonts.plusJakartaSans(
          fontSize: 12.5,
          fontWeight: FontWeight.w500,
          color: AppColors.muted,
        ),
      ),
    );
  }
}

class _ModelPickerSheet extends StatefulWidget {
  const _ModelPickerSheet({
    required this.toolTitle,
    required this.models,
    required this.currentModelId,
  });

  final String toolTitle;
  final List<Map<String, String>> models;
  final String? currentModelId;

  @override
  State<_ModelPickerSheet> createState() => _ModelPickerSheetState();
}

class _ModelPickerSheetState extends State<_ModelPickerSheet> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final q = _query.trim().toLowerCase();
    final filtered = q.isEmpty
        ? widget.models
        : widget.models.where((m) {
            final id = (m['id'] ?? '').toLowerCase();
            final label = (m['label'] ?? '').toLowerCase();
            return id.contains(q) || label.contains(q);
          }).toList();

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: widget.models.length > 10 ? 0.72 : 0.48,
      minChildSize: 0.35,
      maxChildSize: 0.92,
      builder: (context, scrollController) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
              child: Text(
                '选择 ${widget.toolTitle} 模型',
                style: GoogleFonts.plusJakartaSans(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            if (widget.models.length > 6)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: TextField(
                  decoration: const InputDecoration(
                    hintText: '搜索模型名称或 ID…',
                    prefixIcon: Icon(Icons.search, size: 20),
                    isDense: true,
                  ),
                  onChanged: (v) => setState(() => _query = v),
                ),
              ),
            Expanded(
              child: ListView.builder(
                controller: scrollController,
                itemCount: filtered.length + 1,
                itemBuilder: (context, index) {
                  if (index == 0) {
                    final isDefault = widget.currentModelId == null ||
                        widget.currentModelId!.isEmpty;
                    return ListTile(
                      leading: Icon(
                        isDefault
                            ? Icons.radio_button_checked
                            : Icons.radio_button_off,
                        color: isDefault ? AppColors.accent : AppColors.muted,
                        size: 20,
                      ),
                      title: const Text('默认（跟随 CLI 配置）'),
                      onTap: () => Navigator.pop(context, '__default__'),
                    );
                  }
                  final m = filtered[index - 1];
                  final id = m['id'] ?? '';
                  final label = m['label'] ?? id;
                  final selected = widget.currentModelId == id;
                  return ListTile(
                    leading: Icon(
                      selected
                          ? Icons.radio_button_checked
                          : Icons.radio_button_off,
                      color: selected ? AppColors.accent : AppColors.muted,
                      size: 20,
                    ),
                    title: Text(label),
                    subtitle: label != id ? Text(id) : null,
                    onTap: () => Navigator.pop(context, id),
                  );
                },
              ),
            ),
          ],
        );
      },
    );
  }
}
