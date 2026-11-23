import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:grokbot_app/screens/pair_screen.dart';

void main() {
  // 说明：完整 App 的 bootstrap 依赖 FlutterSecureStorage 平台通道，
  // 在宿主测试环境会挂起，因此冒烟测试直接渲染配对页组件。
  testWidgets('配对页冒烟测试', (tester) async {
    await tester.pumpWidget(
      const ProviderScope(child: MaterialApp(home: PairScreen())),
    );
    await tester.pump();
    expect(find.text('8 位配对码'), findsOneWidget);
    expect(find.text('Relay 地址'), findsOneWidget);
  });
}
