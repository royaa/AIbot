import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/tool_catalog.dart';

/// App 本地设置（对话可见 CLI 等）
class SettingsStore {
  static const _enabledCliKey = 'grokbot_enabled_chat_cli_ids_v1';

  /// null = 未设置，表示「全部可选对话 CLI」
  static Future<Set<String>?> loadEnabledChatCliIds() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_enabledCliKey);
    if (raw == null || raw.isEmpty) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return null;
      final ids = decoded
          .map((e) => e.toString().trim())
          .where((e) => e.isNotEmpty)
          .toSet();
      return ids.isEmpty ? null : ids;
    } catch (_) {
      return null;
    }
  }

  static Future<void> saveEnabledChatCliIds(Set<String> ids) async {
    final prefs = await SharedPreferences.getInstance();
    final cleaned = ids.map((e) => e.trim()).where((e) => e.isNotEmpty).toList()
      ..sort();
    await prefs.setString(_enabledCliKey, jsonEncode(cleaned));
  }

  /// 根据目录 + 用户勾选，得到对话条实际可选 CLI（至少 1 个）
  static List<ToolCatalogEntry> resolveVisibleChatTools({
    required List<ToolCatalogEntry> catalog,
    required Set<String>? enabledIds,
  }) {
    final available = chatSelectableCatalog(catalog);
    if (available.isEmpty) {
      return const [
        ToolCatalogEntry(id: 'auto', label: '自动', primary: true),
      ];
    }
    if (enabledIds == null || enabledIds.isEmpty) return available;
    final filtered = available.where((e) => enabledIds.contains(e.id)).toList();
    if (filtered.isEmpty) return available;
    return filtered;
  }

  /// 保证当前 tool 落在可见列表内
  static String sanitizeVisibleTool(
    String? tool, {
    required List<ToolCatalogEntry> visible,
  }) {
    final t = tool?.trim() ?? '';
    if (visible.any((e) => e.id == t)) return t;
    return visible.first.id;
  }
}
