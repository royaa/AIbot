import 'package:flutter_test/flutter_test.dart';
import 'package:grokbot_app/models/chat_session.dart';
import 'package:grokbot_app/services/file_service.dart';

void main() {
  group('FileService.httpBaseFromWs', () {
    test('ws 带端口与路径', () {
      expect(
        FileService.httpBaseFromWs('ws://127.0.0.1:8787/ws'),
        'http://127.0.0.1:8787',
      );
    });

    test('wss 域名路径', () {
      expect(
        FileService.httpBaseFromWs('wss://relay.example.com/ws'),
        'https://relay.example.com',
      );
    });

    test('ws 无路径', () {
      expect(FileService.httpBaseFromWs('ws://host:9000'), 'http://host:9000');
    });
  });

  group('FileOffer', () {
    final j = {
      'fileId': 'f1',
      'name': 'app-release.apk',
      'size': 73010179,
      'mimeType': 'application/vnd.android.package-archive',
      'sha256': 'a' * 64,
      'url': '/files/f1?t=abc',
      'expiresAt': DateTime.now().millisecondsSinceEpoch + 60000,
    };

    test('fromJson/toJson 往返', () {
      final o = FileOffer.fromJson(j);
      expect(o.fileId, 'f1');
      expect(o.sizeLabel, '69.6MB');
      expect(o.expired, isFalse);
      expect(FileOffer.fromJson(o.toJson()).name, 'app-release.apk');
    });

    test('expiresAt 已过 → expired', () {
      final o = FileOffer.fromJson({...j, 'expiresAt': 1});
      expect(o.expired, isTrue);
    });
  });

  group('ChatTurn.offers', () {
    test('挂载与去重数据源', () {
      final turn = ChatTurn.assistant('task-1');
      turn.offers.add(FileOffer.fromJson({
        'fileId': 'f1',
        'name': 'a.apk',
        'size': 10,
        'mimeType': 'application/octet-stream',
        'sha256': 'b' * 64,
        'url': '/files/f1?t=1',
        'expiresAt': 99999999999999,
      }));
      expect(
        turn.offers.any((o) => o.fileId == 'f1'),
        isTrue,
        reason: 'chat_hub 依据 fileId 去重',
      );
    });
  });
}
