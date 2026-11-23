import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/chat_session.dart';
import '../models/tool_catalog.dart';

class SessionStore {
  static const _key = 'grokbot_chat_sessions_v1';
  static const _modelsCacheKey = 'grokbot_tool_models_cache_v1';
  static const _catalogCacheKey = 'grokbot_tool_catalog_cache_v2';

  static Future<({List<ChatSession> sessions, String? currentId})?> load({
    List<ToolCatalogEntry>? catalog,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw == null || raw.isEmpty) return null;
    try {
      final j = jsonDecode(raw) as Map<String, dynamic>;
      final list = j['sessions'] as List<dynamic>? ?? [];
      final sessions = <ChatSession>[];
      for (final item in list) {
        final m = item as Map<String, dynamic>;
        final s = ChatSession(
          id: m['id'] as String?,
          title: m['title'] as String? ?? '会话',
        );
        s.tool = ChatSession.sanitizeTool(
          m['tool'] as String? ?? 'auto',
          catalog: catalog,
        );
        s.workspaceId = m['workspaceId'] as String? ?? 'grokbot';
        final rawModels = m['selectedModels'];
        if (rawModels is Map) {
          for (final entry in rawModels.entries) {
            final k = entry.key?.toString() ?? '';
            final v = entry.value?.toString().trim() ?? '';
            if (k.isNotEmpty && v.isNotEmpty) {
              s.selectedModels[k] = v;
            }
          }
        }
        final turns = m['turns'] as List<dynamic>? ?? [];
        for (final t in turns) {
          final tm = t as Map<String, dynamic>;
          if (tm['isUser'] == true) {
            s.turns.add(ChatTurn.user(tm['text'] as String? ?? ''));
          } else {
            final turn = ChatTurn.assistant(tm['taskId'] as String?);
            turn.body = tm['body'] as String? ?? '';
            turn.finished = tm['finished'] as bool? ?? true;
            turn.phase = tm['phase'] as String? ?? '';
            turn.lastSeq = (tm['lastSeq'] as num?)?.toInt() ?? -1;
            final rawOffers = tm['offers'] as List<dynamic>? ?? [];
            for (final o in rawOffers) {
              if (o is Map) {
                final offer = FileOffer.fromJson(Map<String, dynamic>.from(o));
                // 已过期的文件不再展示（Relay 已清理，无法下载）
                if (!offer.expired) turn.offers.add(offer);
              }
            }
            s.turns.add(turn);
          }
        }
        sessions.add(s);
      }
      return (sessions: sessions, currentId: j['currentId'] as String?);
    } catch (_) {
      return null;
    }
  }

  static Future<void> save({
    required List<ChatSession> sessions,
    required String? currentId,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    final data = {
      'currentId': currentId,
      'sessions': sessions
          .map((s) => {
                'id': s.id,
                'title': s.title,
                'tool': s.tool,
                'workspaceId': s.workspaceId,
                'selectedModels': s.selectedModels,
                'turns': s.turns
                    .map((t) => t.isUser
                        ? {'isUser': true, 'text': t.text}
                        : {
                            'isUser': false,
                            'taskId': t.taskId,
                            'body': t.body,
                            'finished': t.finished,
                            'phase': t.phase,
                            'lastSeq': t.lastSeq,
                            'offers': t.offers.map((o) => o.toJson()).toList(),
                          })
                    .toList(),
              })
          .toList(),
    };
    await prefs.setString(_key, jsonEncode(data));
  }

  static Future<Map<String, List<Map<String, String>>>> loadToolModelsCache() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_modelsCacheKey);
    if (raw == null || raw.isEmpty) return {};
    try {
      final decoded = jsonDecode(raw);
      return parseToolModelsMap(decoded);
    } catch (_) {
      return {};
    }
  }

  static Future<void> saveToolModelsCache(
    Map<String, List<Map<String, String>>> models,
  ) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_modelsCacheKey, jsonEncode(models));
  }

  static Future<List<ToolCatalogEntry>> loadToolCatalogCache() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_catalogCacheKey);
    if (raw == null || raw.isEmpty) return List.of(defaultToolCatalog);
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return List.of(defaultToolCatalog);
      final out = <ToolCatalogEntry>[];
      for (final item in decoded) {
        if (item is Map) {
          final e = ToolCatalogEntry.fromJson(Map<String, dynamic>.from(item));
          if (e.id.isNotEmpty) out.add(e);
        }
      }
      if (out.isEmpty) return List.of(defaultToolCatalog);
      return out;
    } catch (_) {
      return List.of(defaultToolCatalog);
    }
  }

  static Future<void> saveToolCatalogCache(List<ToolCatalogEntry> catalog) async {
    final prefs = await SharedPreferences.getInstance();
    final data = catalog
        .map((e) => {
              'id': e.id,
              'label': e.label,
              'primary': e.primary,
              'supportsModels': e.supportsModels,
              'hostKind': e.hostKind == ToolHostKind.agent ? 'agent' : 'cli',
              'chatSelectable': e.chatSelectable,
              if (e.capabilityNote != null && e.capabilityNote!.isNotEmpty)
                'capabilityNote': e.capabilityNote,
            })
        .toList();
    await prefs.setString(_catalogCacheKey, jsonEncode(data));
  }

  static Map<String, List<Map<String, String>>> parseToolModelsMap(
    dynamic raw,
  ) {
    if (raw is! Map) return {};
    final out = <String, List<Map<String, String>>>{};
    for (final entry in raw.entries) {
      final tool = entry.key?.toString() ?? '';
      final list = entry.value;
      if (tool.isEmpty || list is! List) continue;
      final parsed = <Map<String, String>>[];
      for (final item in list) {
        if (item is Map) {
          final id = item['id']?.toString().trim() ?? '';
          final label = item['label']?.toString().trim() ?? id;
          if (id.isNotEmpty) {
            parsed.add({'id': id, 'label': label.isEmpty ? id : label});
          }
        }
      }
      if (parsed.isNotEmpty) out[tool] = parsed;
    }
    return out;
  }
}
