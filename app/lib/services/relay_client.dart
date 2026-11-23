import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:uuid/uuid.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'cred_store.dart';

typedef MessageHandler = void Function(Map<String, dynamic> msg);
typedef VoidCallback = void Function();

class RelayClient {
  RelayClient(this.relayUrl);

  final String relayUrl;
  WebSocketChannel? _channel;
  StreamSubscription? _sub;
  Timer? _reconnectTimer;
  String? accessToken;
  String? agentId;
  String? deviceId;

  bool relayConnected = false;
  bool agentOnline = false;
  String? lastError;
  /// 收到过 Relay 的 auth 错误（token 已清），启动流程应去配对页
  bool authRejected = false;

  MessageHandler? onMessage;
  VoidCallback? onStateChanged;
  /// 鉴权 hello 成功后（含自动重连）触发，用于 task.catchup
  VoidCallback? onAuthenticated;

  bool _disposed = false;
  bool _suppressReconnect = false;
  int _reconnectAttempt = 0;
  bool _authHelloSent = false;

  void _notifyState() => onStateChanged?.call();

  void _scheduleReconnect() {
    if (_disposed || _suppressReconnect) return;
    _reconnectTimer?.cancel();
    final secs = math.min(30, 1 << math.min(_reconnectAttempt, 4));
    _reconnectAttempt++;
    lastError = lastError ?? '连接断开，${secs}s 后重连…';
    _notifyState();
    _reconnectTimer = Timer(Duration(seconds: secs), () async {
      if (_disposed || _suppressReconnect) return;
      try {
        await connect(reauth: true);
      } catch (e) {
        lastError = e.toString();
        _notifyState();
        _scheduleReconnect();
      }
    });
  }

  Future<void> connect({bool reauth = true}) async {
    accessToken ??= await CredStore.read('accessToken');
    agentId ??= await CredStore.read('agentId');
    deviceId ??= await CredStore.read('deviceId');
    final effectiveUrl = relayUrl;
    await CredStore.write('relayUrl', effectiveUrl);
    lastError = null;
    authRejected = false;
    _authHelloSent = false;
    await _sub?.cancel();
    relayConnected = false;
    agentOnline = false;
    _notifyState();

    _channel = WebSocketChannel.connect(Uri.parse(effectiveUrl));
    _sub = _channel!.stream.listen(
      (event) async {
        relayConnected = true;
        _reconnectAttempt = 0;
        final msg = jsonDecode(event as String) as Map<String, dynamic>;
        final type = msg['type'] as String?;
        if (type == 'hello') {
          _notifyState();
        }
        if (type == 'auth.token') {
          final p = msg['payload'] as Map<String, dynamic>;
          accessToken = p['accessToken'] as String?;
          agentId = p['agentId'] as String?;
          deviceId = p['deviceId'] as String?;
          authRejected = false;
          try {
            if (accessToken != null) {
              await CredStore.write('accessToken', accessToken!);
            }
            if (agentId != null) {
              await CredStore.write('agentId', agentId!);
            }
            if (deviceId != null) {
              await CredStore.write('deviceId', deviceId!);
            }
          } catch (_) {
            // CredStore 内部已有 prefs 回退；此处避免中断监听
          }
          // 配对完成或刷新 token 后，用 token 再 hello 一次，便于 Relay 登记并补发 agent.status
          if (accessToken != null) {
            _sendAuthHello();
          }
          _notifyState();
        }
        if (type == 'agent.status') {
          final p = msg['payload'] as Map<String, dynamic>;
          agentOnline = p['online'] == true;
          _notifyState();
        }
        if (type == 'error') {
          final p = msg['payload'] as Map<String, dynamic>;
          lastError = p['message'] as String? ?? '未知错误';
          if (p['code'] == 'auth') {
            authRejected = true;
            accessToken = null;
            agentId = null;
            deviceId = null;
            await CredStore.delete('accessToken');
            await CredStore.delete('agentId');
            await CredStore.delete('deviceId');
            // token 已失效，停止盲目重连以免反复弹 Invalid token
            _suppressReconnect = true;
            _reconnectTimer?.cancel();
          }
          _notifyState();
        }
        // Relay 回 hello 且我们已发过带 token 的 hello → 视为已登记
        if (type == 'hello' && _authHelloSent && accessToken != null) {
          onAuthenticated?.call();
        }
        onMessage?.call(msg);
      },
      onError: (Object e) {
        relayConnected = false;
        agentOnline = false;
        lastError = e.toString();
        _notifyState();
        _scheduleReconnect();
      },
      onDone: () {
        relayConnected = false;
        agentOnline = false;
        _notifyState();
        _scheduleReconnect();
      },
    );
    send('hello', {'role': 'mobile', 'version': '0.1.0'});
    if (reauth && accessToken != null) {
      _sendAuthHello();
    }
  }

  void _sendAuthHello() {
    _authHelloSent = true;
    send('hello', {
      'role': 'mobile',
      'token': accessToken,
      'deviceId': deviceId,
      'agentId': agentId,
    });
  }

  Future<void> pair(String pairCode, String deviceName) async {
    send('pair.complete', {
      'pairCode': pairCode.toUpperCase(),
      'deviceName': deviceName,
    });
  }

  String sendTask({
    required String sessionId,
    required String workspaceId,
    required String tool,
    required String prompt,
    Map<String, dynamic>? options,
  }) {
    final taskId = const Uuid().v4();
    send('task.create', {
      'taskId': taskId,
      'sessionId': sessionId,
      'workspaceId': workspaceId,
      'tool': tool,
      'prompt': prompt,
      if (options != null) 'options': options,
    });
    return taskId;
  }

  void confirm(String taskId, String confirmId, bool approved) {
    send('task.confirm.response', {
      'taskId': taskId,
      'confirmId': confirmId,
      'approved': approved,
    });
  }

  void cancelTask(String taskId) {
    send('task.cancel', {'taskId': taskId});
  }

  void requestCatchup(List<Map<String, dynamic>> tasks) {
    if (tasks.isEmpty) return;
    send('task.catchup', {'tasks': tasks});
  }

  void send(String type, Map<String, dynamic> payload) {
    final msg = {
      'id': const Uuid().v4(),
      'ts': DateTime.now().millisecondsSinceEpoch,
      'type': type,
      'role': 'mobile',
      'payload': payload,
    };
    _channel?.sink.add(jsonEncode(msg));
  }

  Future<void> forceReconnect() async {
    _suppressReconnect = true;
    _reconnectTimer?.cancel();
    lastError = null;
    await _sub?.cancel();
    try {
      await _channel?.sink.close();
    } catch (_) {}
    _channel = null;
    relayConnected = false;
    agentOnline = false;
    _notifyState();
    _suppressReconnect = false;
    _reconnectAttempt = 0;
    await connect(reauth: true);
    await Future<void>.delayed(const Duration(milliseconds: 1200));
  }

  /// 清除本地配对并断开，随后应进入 PairScreen 重新扫码
  Future<void> clearPairingAndDisconnect() async {
    _suppressReconnect = true;
    _reconnectTimer?.cancel();
    await _sub?.cancel();
    try {
      await _channel?.sink.close();
    } catch (_) {}
    _channel = null;
    accessToken = null;
    agentId = null;
    deviceId = null;
    relayConnected = false;
    agentOnline = false;
    authRejected = false;
    lastError = null;
    await CredStore.clearPairing();
    _notifyState();
  }

  void dispose() {
    _disposed = true;
    _suppressReconnect = true;
    _reconnectTimer?.cancel();
    _sub?.cancel();
    _channel?.sink.close();
  }
}
