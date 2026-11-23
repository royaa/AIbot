import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../services/cred_store.dart';
import '../services/relay_client.dart';
import '../theme/app_theme.dart';
import 'chat_shell.dart';
import 'pair_screen.dart';

/// 启动时若已有 token，自动连 Relay 并进入任务页；否则进入配对页。
class BootstrapScreen extends StatefulWidget {
  const BootstrapScreen({super.key});

  @override
  State<BootstrapScreen> createState() => _BootstrapScreenState();
}

class _BootstrapScreenState extends State<BootstrapScreen> {
  static const _defaultRelay = 'ws://replay.githun.cn/ws';

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  /// 历史扫码可能写入 127.0.0.1；生产一律回落到域名
  static String _normalizeRelay(String raw) {
    var relayUrl = raw.trim();
    if (relayUrl.isEmpty) return _defaultRelay;
    if (relayUrl.startsWith('wss://replay.githun.cn/')) {
      relayUrl = relayUrl.replaceFirst('wss://', 'ws://');
    }
    final lower = relayUrl.toLowerCase();
    if (lower.contains('127.0.0.1') ||
        lower.contains('localhost') ||
        lower.contains('[::1]')) {
      return _defaultRelay;
    }
    return relayUrl;
  }

  Future<void> _bootstrap() async {
    final token = await CredStore.read('accessToken');
    final storedRelay = await CredStore.read('relayUrl');
    var relayUrl = _normalizeRelay(
      storedRelay != null && storedRelay.trim().isNotEmpty
          ? storedRelay.trim()
          : _defaultRelay,
    );
    await CredStore.write('relayUrl', relayUrl);

    // 无凭证 → 配对
    if (token == null || token.isEmpty) {
      _goPair();
      return;
    }

    final client = RelayClient(relayUrl);
    try {
      await client.connect(reauth: true);
      // 最多等约 5s：优先等连上；若明确鉴权失败再去配对
      for (var i = 0; i < 25; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 200));
        if (!mounted) {
          client.dispose();
          return;
        }
        if (client.authRejected) {
          client.dispose();
          _goPair();
          return;
        }
        if (client.relayConnected) {
          _goChat(relayUrl, client);
          return;
        }
      }
    } catch (_) {
      // 网络异常：有 token 仍进主界面，由 ChatShell 内重连
    }

    if (!mounted) {
      client.dispose();
      return;
    }
    if (client.authRejected) {
      client.dispose();
      _goPair();
      return;
    }
    // 有本地 token 时，连接超时也不丢配对、不强制扫码
    _goChat(relayUrl, client);
  }

  void _goChat(String relayUrl, RelayClient client) {
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (_) => ChatShell(relayUrl: relayUrl, client: client),
      ),
    );
  }

  void _goPair() {
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const PairScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'AI Bot',
              style: GoogleFonts.plusJakartaSans(
                fontSize: 26,
                fontWeight: FontWeight.w700,
                letterSpacing: -0.5,
                color: AppColors.ink,
              ),
            ),
            const SizedBox(height: 24),
            const SizedBox(
              width: 28,
              height: 28,
              child: CircularProgressIndicator(strokeWidth: 2.4),
            ),
            const SizedBox(height: 16),
            Text(
              '正在连接…',
              style: GoogleFonts.plusJakartaSans(
                fontSize: 14,
                color: AppColors.muted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
