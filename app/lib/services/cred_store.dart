import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 配对凭证：优先加密存储，失败时回退 SharedPreferences，避免重启丢配对。
class CredStore {
  CredStore._();

  static const _secure = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  static String _prefsKey(String key) => 'grokbot_cred_$key';

  static Future<void> write(String key, String value) async {
    var secureOk = false;
    try {
      await _secure.write(key: key, value: value);
      secureOk = true;
    } catch (_) {}
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefsKey(key), value);
    if (!secureOk) {
      // 至少保证明文回退可用
    }
  }

  static Future<String?> read(String key) async {
    try {
      final v = await _secure.read(key: key);
      if (v != null && v.isNotEmpty) {
        // 回填 prefs，防止只写过 secure 的老数据
        final prefs = await SharedPreferences.getInstance();
        if (prefs.getString(_prefsKey(key)) != v) {
          await prefs.setString(_prefsKey(key), v);
        }
        return v;
      }
    } catch (_) {}
    final prefs = await SharedPreferences.getInstance();
    final fallback = prefs.getString(_prefsKey(key));
    if (fallback != null && fallback.isNotEmpty) {
      // 尝试写回 secure，下次可读加密副本
      try {
        await _secure.write(key: key, value: fallback);
      } catch (_) {}
    }
    return fallback;
  }

  static Future<void> delete(String key) async {
    try {
      await _secure.delete(key: key);
    } catch (_) {}
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_prefsKey(key));
  }

  /// 清除配对凭证（保留 relayUrl，方便重新扫码）
  static Future<void> clearPairing() async {
    await delete('accessToken');
    await delete('agentId');
    await delete('deviceId');
  }
}
