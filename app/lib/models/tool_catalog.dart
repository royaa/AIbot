/// 能力归属：cli = 本机 CLI；agent = PC Agent 托管
enum ToolHostKind {
  cli,
  agent,
}

ToolHostKind parseToolHostKind(dynamic raw) {
  final s = raw?.toString().trim().toLowerCase() ?? '';
  if (s == 'agent') return ToolHostKind.agent;
  return ToolHostKind.cli;
}

/// Agent 下发的 CLI 目录条目
class ToolCatalogEntry {
  const ToolCatalogEntry({
    required this.id,
    required this.label,
    this.primary = false,
    this.supportsModels = false,
    this.hostKind = ToolHostKind.cli,
    this.capabilityNote,
    this.chatSelectable = true,
  });

  final String id;
  final String label;
  final bool primary;
  final bool supportsModels;
  final ToolHostKind hostKind;
  final String? capabilityNote;
  /// false = 动作类（取文件等），不能当对话 CLI
  final bool chatSelectable;

  String get hostKindLabel =>
      hostKind == ToolHostKind.agent ? 'Agent 托管' : 'CLI 自带';

  factory ToolCatalogEntry.fromJson(Map<String, dynamic> j) {
    // 旧 Agent 无 chatSelectable：取文件默认不可选
    final id = j['id']?.toString() ?? '';
    final rawSelectable = j['chatSelectable'];
    final chatSelectable = rawSelectable == null
        ? id != 'file' && id != 'svn' && id != 'cursor'
        : rawSelectable == true;
    return ToolCatalogEntry(
      id: id,
      label: j['label']?.toString() ?? id,
      primary: j['primary'] == true,
      supportsModels: j['supportsModels'] == true,
      hostKind: parseToolHostKind(j['hostKind']),
      capabilityNote: j['capabilityNote']?.toString(),
      chatSelectable: chatSelectable,
    );
  }
}

/// 离线/旧 Agent 兜底目录（仅对话 CLI）
const defaultToolCatalog = <ToolCatalogEntry>[
  ToolCatalogEntry(
    id: 'auto',
    label: '自动 (Claude)',
    primary: true,
    capabilityNote: '自动落到 Claude；模型与 MCP 仍由该 CLI 决定',
  ),
  ToolCatalogEntry(
    id: 'claude',
    label: 'Claude',
    primary: true,
    supportsModels: true,
    capabilityNote: '模型与 MCP 由本机该 CLI 配置决定；公共技能会自动注入',
  ),
  ToolCatalogEntry(
    id: 'cursor_agent',
    label: 'Cursor Agent',
    primary: true,
    supportsModels: true,
    capabilityNote: '模型与 MCP 由本机该 CLI 配置决定；公共技能会自动注入',
  ),
  ToolCatalogEntry(
    id: 'codex',
    label: 'Codex',
    primary: true,
    supportsModels: true,
    capabilityNote: '模型与 MCP 由本机该 CLI 配置决定；公共技能会自动注入',
  ),
  ToolCatalogEntry(
    id: 'workbuddy',
    label: 'WorkBuddy',
    primary: true,
    hostKind: ToolHostKind.agent,
    capabilityNote: '由 PC Agent 直接执行，与当前对话 CLI / MCP 无关',
  ),
];

/// 目录里可供「对话选择」的条目（primary + chatSelectable）
List<ToolCatalogEntry> chatSelectableCatalog(List<ToolCatalogEntry> catalog) {
  return catalog
      .where((e) => e.primary && e.chatSelectable && e.id.isNotEmpty)
      .toList();
}

/// 以 [preferred] 为准，并补上 [fallback] 里缺失的条目（避免旧缓存/旧 Agent 丢掉新 CLI）
List<ToolCatalogEntry> mergeToolCatalog(
  List<ToolCatalogEntry> preferred,
  List<ToolCatalogEntry> fallback,
) {
  final byId = <String, ToolCatalogEntry>{};
  for (final e in fallback) {
    if (e.id.isNotEmpty) byId[e.id] = e;
  }
  for (final e in preferred) {
    if (e.id.isNotEmpty) byId[e.id] = e;
  }
  final order = <String>[];
  for (final e in preferred) {
    if (e.id.isNotEmpty && !order.contains(e.id)) order.add(e.id);
  }
  for (final e in fallback) {
    if (e.id.isNotEmpty && !order.contains(e.id)) order.add(e.id);
  }
  return [for (final id in order) byId[id]!];
}
