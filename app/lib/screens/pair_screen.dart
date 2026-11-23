import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../services/relay_client.dart';
import '../theme/app_theme.dart';
import 'chat_shell.dart';

class PairScreen extends ConsumerStatefulWidget {
  const PairScreen({super.key});

  @override
  ConsumerState<PairScreen> createState() => _PairScreenState();
}

class _PairScreenState extends ConsumerState<PairScreen> {
  final relayCtrl = TextEditingController(text: 'ws://127.0.0.1:8787/ws');
  final codeCtrl = TextEditingController();
  final nameCtrl = TextEditingController(text: 'My Phone');
  bool scanning = false;
  bool pairing = false;
  String? error;

  static const _defaultRelay = 'ws://127.0.0.1:8787/ws';

  String _normalizeRelay(String raw) {
    final u = raw.trim();
    if (u.isEmpty) return _defaultRelay;
    return u;
  }

  Future<void> _pair() async {
    setState(() {
      error = null;
      pairing = true;
    });
    final relay = _normalizeRelay(relayCtrl.text);
    relayCtrl.text = relay;
    final client = RelayClient(relay);
    try {
      await client.connect(reauth: false);
      await Future<void>.delayed(const Duration(milliseconds: 300));
      client.pair(codeCtrl.text.trim(), nameCtrl.text.trim());
      await Future<void>.delayed(const Duration(seconds: 2));
      if (!mounted) return;
      if (client.accessToken == null) {
        setState(() {
          error = '配对失败，请检查 Relay 与配对码';
          pairing = false;
        });
        client.dispose();
        return;
      }
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => ChatShell(
            relayUrl: relay,
            client: client,
          ),
        ),
      );
    } catch (e) {
      setState(() {
        error = e.toString();
        pairing = false;
      });
    }
  }

  void _onScan(BarcodeCapture capture) {
    final raw = capture.barcodes.firstOrNull?.rawValue;
    if (raw == null) return;
    try {
      final j = jsonDecode(raw) as Map<String, dynamic>;
      if (j['pairCode'] != null) codeCtrl.text = j['pairCode'] as String;
      if (j['relayUrl'] != null) {
        relayCtrl.text = _normalizeRelay(j['relayUrl'] as String);
      }
      setState(() => scanning = false);
    } catch (_) {
      codeCtrl.text = raw;
      setState(() => scanning = false);
    }
  }

  @override
  void dispose() {
    relayCtrl.dispose();
    codeCtrl.dispose();
    nameCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 36, 24, 24),
          children: [
            Text(
              'AI Bot',
              textAlign: TextAlign.center,
              style: GoogleFonts.plusJakartaSans(
                fontSize: 32,
                fontWeight: FontWeight.w700,
                letterSpacing: -0.8,
                color: AppColors.ink,
              ),
            ),
            const SizedBox(height: 10),
            Text(
              '用手机遥控 PC 上的 AI CLI',
              textAlign: TextAlign.center,
              style: GoogleFonts.plusJakartaSans(
                fontSize: 15,
                height: 1.4,
                color: AppColors.muted,
              ),
            ),
            const SizedBox(height: 36),
            TextField(
              controller: relayCtrl,
              decoration: const InputDecoration(labelText: 'Relay 地址'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: nameCtrl,
              decoration: const InputDecoration(labelText: '设备名称'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: codeCtrl,
              decoration: const InputDecoration(labelText: '8 位配对码'),
              textCapitalization: TextCapitalization.characters,
            ),
            if (error != null)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(
                  error!,
                  style: GoogleFonts.plusJakartaSans(
                    color: AppColors.stop,
                    fontSize: 13.5,
                  ),
                ),
              ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: pairing ? null : _pair,
              child: pairing
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.2,
                        color: Colors.white,
                      ),
                    )
                  : const Text('配对'),
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: () => setState(() => scanning = !scanning),
              child: Text(scanning ? '关闭扫码' : '扫码配对'),
            ),
            if (scanning) ...[
              const SizedBox(height: 16),
              ClipRRect(
                borderRadius: BorderRadius.circular(16),
                child: SizedBox(
                  height: 260,
                  child: MobileScanner(onDetect: _onScan),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
