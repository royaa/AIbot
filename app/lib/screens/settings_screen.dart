import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../models/tool_catalog.dart';
import '../services/chat_hub.dart';
import '../services/relay_client.dart';
import '../services/settings_store.dart';
import '../theme/app_theme.dart';
import 'pair_screen.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({
    super.key,
    required this.client,
    required this.chatHub,
  });

  final RelayClient client;
  final ChatHub chatHub;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  Set<String> _enabled = {};
  bool _loaded = false;
  bool _busy = false;

  List<ToolCatalogEntry> get _available =>
      chatSelectableCatalog(widget.chatHub.toolCatalog);

  @override
  void initState() {
    super.initState();
    _load();
    widget.chatHub.addListener(_onHub);
  }

  @override
  void dispose() {
    widget.chatHub.removeListener(_onHub);
    super.dispose();
  }

  void _onHub() {
    if (!mounted) return;
    setState(() {
      // 目录更新后，去掉已不存在的勾选
      final ids = _available.map((e) => e.id).toSet();
      _enabled.removeWhere((id) => !ids.contains(id));
      if (_enabled.isEmpty && ids.isNotEmpty) {
        _enabled = Set.of(ids);
      }
    });
  }

  Future<void> _load() async {
    final saved = await SettingsStore.loadEnabledChatCliIds();
    final available = _available;
    final allIds = available.map((e) => e.id).toSet();
    setState(() {
      if (saved == null || saved.isEmpty) {
        _enabled = Set.of(allIds);
      } else {
        _enabled = saved.intersection(allIds);
        if (_enabled.isEmpty) _enabled = Set.of(allIds);
      }
      _loaded = true;
    });
  }

  Future<void> _toggle(String id, bool on) async {
    if (!_loaded) return;
    final next = Set<String>.of(_enabled);
    if (on) {
      next.add(id);
    } else {
      if (next.length <= 1 && next.contains(id)) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('至少保留一个对话 CLI')),
        );
        return;
      }
      next.remove(id);
    }
    setState(() => _enabled = next);
    await SettingsStore.saveEnabledChatCliIds(next);
    await widget.chatHub.applyChatCliVisibility(next);
  }

  Future<void> _forceReconnect() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await widget.client.forceReconnect();
      if (!mounted) return;
      final ok = widget.client.relayConnected && widget.client.agentOnline;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            ok
                ? '已重连，PC Agent 在线'
                : widget.client.relayConnected
                    ? '已连 Relay；若仍离线请确认 PC 上 npm run agent'
                    : '重连失败，请检查网络与 Relay 地址',
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _rePair() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('重新配对？'),
        content: const Text(
          '将清除本机配对凭证并打开扫码页。\n'
          '请先在电脑执行 npm run agent:pair 显示新配对码，再用 App 扫码或输入。',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('去配对'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    await widget.client.clearPairingAndDisconnect();
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const PairScreen()),
      (_) => false,
    );
  }

  String get _statusText {
    final c = widget.client;
    if (c.relayConnected && c.agentOnline) return 'Relay 已连接 · Agent 在线';
    if (c.relayConnected) return 'Relay 已连接 · Agent 离线';
    return '未连接 Relay';
  }

  @override
  Widget build(BuildContext context) {
    final available = _available;
    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        title: const Text('设置'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        children: [
          Text(
            '对话可选 CLI',
            style: GoogleFonts.plusJakartaSans(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            '列表来自当前连接的 PC：只包含本机已安装、Agent 能执行的 CLI。勾选后才会出现在聊天里，至少保留一个。',
            style: GoogleFonts.plusJakartaSans(
              fontSize: 13,
              color: AppColors.muted,
              height: 1.35,
            ),
          ),
          const SizedBox(height: 12),
          if (!_loaded)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
            )
          else if (available.isEmpty)
            Text(
              '暂无可用对话 CLI（等待 Agent 在线上报）',
              style: GoogleFonts.plusJakartaSans(
                fontSize: 13,
                color: AppColors.muted,
              ),
            )
          else
            Container(
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppColors.divider),
              ),
              child: Column(
                children: [
                  for (var i = 0; i < available.length; i++) ...[
                    if (i > 0)
                      const Divider(height: 1, color: AppColors.divider),
                    SwitchListTile(
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 2,
                      ),
                      title: Text(
                        available[i].label,
                        style: GoogleFonts.plusJakartaSans(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      subtitle: Text(
                        available[i].hostKindLabel +
                            (available[i].capabilityNote?.isNotEmpty == true
                                ? ' · ${available[i].capabilityNote}'
                                : ''),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: GoogleFonts.plusJakartaSans(
                          fontSize: 12,
                          color: AppColors.muted,
                        ),
                      ),
                      value: _enabled.contains(available[i].id),
                      activeColor: AppColors.accent,
                      onChanged: (on) => _toggle(available[i].id, on),
                    ),
                  ],
                ],
              ),
            ),
          const SizedBox(height: 28),
          Text(
            '连接',
            style: GoogleFonts.plusJakartaSans(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            _statusText,
            style: GoogleFonts.plusJakartaSans(
              fontSize: 13,
              color: AppColors.muted,
            ),
          ),
          const SizedBox(height: 12),
          Container(
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.divider),
            ),
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.sync, color: AppColors.ink),
                  title: Text(
                    '重连 Relay',
                    style: GoogleFonts.plusJakartaSans(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  subtitle: Text(
                    '重新连接中转并检测 PC Agent',
                    style: GoogleFonts.plusJakartaSans(
                      fontSize: 12.5,
                      color: AppColors.muted,
                    ),
                  ),
                  trailing: _busy
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.chevron_right, color: AppColors.muted),
                  onTap: _busy ? null : _forceReconnect,
                ),
                const Divider(height: 1, color: AppColors.divider),
                ListTile(
                  leading: const Icon(Icons.qr_code_2, color: AppColors.ink),
                  title: Text(
                    '重新扫码配对',
                    style: GoogleFonts.plusJakartaSans(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  subtitle: Text(
                    '清除本机凭证，用新配对码绑定 PC',
                    style: GoogleFonts.plusJakartaSans(
                      fontSize: 12.5,
                      color: AppColors.muted,
                    ),
                  ),
                  trailing: const Icon(
                    Icons.chevron_right,
                    color: AppColors.muted,
                  ),
                  onTap: _busy ? null : _rePair,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
