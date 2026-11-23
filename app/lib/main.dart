import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'screens/bootstrap_screen.dart';
import 'theme/app_theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ProviderScope(child: AiBotApp()));
}

class AiBotApp extends StatelessWidget {
  const AiBotApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AI Bot',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      home: const BootstrapScreen(),
    );
  }
}
