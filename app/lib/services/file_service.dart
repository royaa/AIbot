import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';

import '../models/chat_session.dart';

class _DigestSink implements Sink<Digest> {
  String hex = '';
  @override
  void add(Digest data) => hex = data.toString();
  @override
  void close() {}
}

/// PC → 手机 文件下载：走 Relay HTTP 通道（支持断点续传），完成后 sha256 校验。
class FileService {
  FileService._(this._httpBase, this._saveDir);

  final String _httpBase;
  final String _saveDir;
  final HttpClient _http = HttpClient()
    ..connectionTimeout = const Duration(seconds: 20);

  static FileService? _instance;

  /// relayUrl 形如 ws://host:port/ws 或 wss://host/ws
  static Future<FileService> instance(String relayUrl) async {
    final base = httpBaseFromWs(relayUrl);
    if (_instance != null && _instance!._httpBase == base) return _instance!;
    final root = await getExternalStorageDirectory(); // App 专属外部目录，免权限
    final dir = '${root?.path ?? Directory.systemTemp.path}/AIBot';
    await Directory(dir).create(recursive: true);
    _instance = FileService._(base, dir);
    return _instance!;
  }

  /// ws(s)://host[:port]/path → http(s)://host[:port]
  static String httpBaseFromWs(String relayUrl) {
    var u = relayUrl.trim();
    if (u.startsWith('wss://')) {
      u = 'https://${u.substring(6)}';
    } else if (u.startsWith('ws://')) {
      u = 'http://${u.substring(5)}';
    }
    final schemeEnd = u.indexOf('://') + 3;
    final slash = u.indexOf('/', schemeEnd);
    return slash > 0 ? u.substring(0, slash) : u;
  }

  String localPathOf(FileOffer offer) =>
      '$_saveDir/${offer.fileId}_${offer.name}';

  /// 已完整下载过则返回本地路径
  String? savedPathOf(FileOffer offer) {
    final p = localPathOf(offer);
    final f = File(p);
    return f.existsSync() && f.lengthSync() == offer.size ? p : null;
  }

  Future<HttpClientResponse> _get(Uri uri, {String? range}) async {
    final req = await _http.getUrl(uri);
    if (range != null) req.headers.set(HttpHeaders.rangeHeader, range);
    return req.close();
  }

  /// 下载 offer.url（相对 Relay 根）到本地，onProgress 回调 0~1。
  /// 断网/取消抛异常时保留 .part，重试自动从断点续传。
  Future<String> download(
    FileOffer offer, {
    void Function(double progress)? onProgress,
  }) async {
    final local = File(localPathOf(offer));
    if (await local.exists() && await local.length() == offer.size) {
      onProgress?.call(1);
      return local.path;
    }

    final uri = Uri.parse('$_httpBase${offer.url}');
    final part = File('${local.path}.part');
    var downloaded = (await part.exists()) ? await part.length() : 0;

    var res = downloaded > 0 && downloaded < offer.size
        ? await _get(uri, range: 'bytes=$downloaded-')
        : null;
    if (res != null && res.statusCode != 206) {
      // Relay 未接受 Range（文件可能已变），退回全量下载
      await res.drain<void>();
      res = null;
      downloaded = 0;
    }
    res ??= await _get(uri);

    if (res.statusCode != 200 && res.statusCode != 206) {
      await res.drain<void>();
      if (res.statusCode == 404 || res.statusCode == 410) {
        throw Exception('文件已过期或被清理，请在 PC 重新推送');
      }
      throw Exception('下载失败 HTTP ${res.statusCode}');
    }

    final raf = await part.open(
      mode: downloaded == 0 ? FileMode.write : FileMode.append,
    );
    var received = downloaded;
    try {
      await for (final chunk in res) {
        await raf.writeFrom(chunk);
        received += chunk.length;
        onProgress?.call(
          offer.size > 0 ? (received / offer.size).clamp(0.0, 1.0) : 0,
        );
      }
    } catch (e) {
      await raf.close();
      throw Exception('下载中断：$e（重试将从断点续传）');
    }
    await raf.close();

    if (received != offer.size) {
      throw Exception('下载不完整 $received/${offer.size}（重试将从断点续传）');
    }
    if (offer.sha256.isNotEmpty) {
      final hex = await sha256OfFile(part);
      if (hex != offer.sha256) {
        await part.delete().catchError((_) => part);
        throw Exception('sha256 校验失败，请重试');
      }
    }
    if (await local.exists()) await local.delete();
    await part.rename(local.path);
    onProgress?.call(1);
    return local.path;
  }

  static Future<String> sha256OfFile(File f) async {
    final sink = _DigestSink();
    final input = sha256.startChunkedConversion(sink);
    await for (final chunk in f.openRead()) {
      input.add(chunk);
    }
    input.close();
    return sink.hex;
  }

  /// 打开本地文件（APK 会拉起系统安装器，需用户手动确认安装）
  static Future<String> openLocal(String path) async {
    final result = await OpenFilex.open(path);
    if (result.type != ResultType.done) {
      return '打开失败: ${result.message}';
    }
    return '';
  }
}
