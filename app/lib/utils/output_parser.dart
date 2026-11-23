import 'dart:convert';

/// 过滤 CLI 噪音（如 Warning: no stdin…）
String sanitizeCliOutput(String text) {
  if (text.isEmpty) return text;
  final kept = <String>[];
  for (final line in text.split('\n')) {
    final t = line.trimLeft();
    if (t.toLowerCase().startsWith('warning:')) continue;
    kept.add(line);
  }
  return kept.join('\n');
}

/// 将模型 CLI 流式 JSON 行转为可读 Markdown 文本（Agent 未解析时的兜底）
String parseModelOutputChunk(String chunk) {
  return sanitizeCliOutput(_parseModelOutputChunkRaw(chunk));
}

String _parseModelOutputChunkRaw(String chunk) {
  if (chunk.isEmpty) return chunk;
  final out = StringBuffer();
  for (final line in chunk.split('\n')) {
    final t = line.trim();
    if (t.isEmpty) continue;
    if (t.startsWith('{')) {
      final parsed = _parseJsonLine(t);
      if (parsed != null && parsed.isNotEmpty) out.write(parsed);
    } else {
      out.writeln(line);
    }
  }
  return out.toString();
}

String? _parseJsonLine(String line) {
  try {
    final j = jsonDecode(line) as Map<String, dynamic>;
    final type = j['type'] as String?;

    if (type == 'assistant') {
      final msg = j['message'];
      if (msg is Map<String, dynamic>) {
        return _anthropicContent(msg['content']);
      }
    }
    if (type == 'content_block_delta') {
      final delta = j['delta'];
      if (delta is Map && delta['text'] is String) {
        return delta['text'] as String;
      }
    }
    if (type == 'result' && j['result'] is String) {
      return '${j['result']}\n';
    }
    if (type == 'text' && j['text'] is String) {
      return j['text'] as String;
    }
    // OpenAI / grok-cli 格式兜底
    final role = j['role'] as String?;
    if (role == 'user' || role == 'tool') return null;
    if (role == 'assistant' && j['content'] is String) {
      final c = (j['content'] as String).trim();
      return c.isEmpty ? null : '$c\n';
    }
    return null;
  } catch (_) {
    return null;
  }
}

String? _anthropicContent(dynamic content) {
  if (content is String) return content;
  if (content is! List) return null;
  final buf = StringBuffer();
  for (final block in content) {
    if (block is Map && block['type'] == 'text' && block['text'] is String) {
      buf.write(block['text']);
    }
  }
  return buf.isEmpty ? null : buf.toString();
}
