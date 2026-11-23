// 与 @grokbot/protocol TypeScript 定义同步，供 Flutter 使用。
// 生成/更新：修改 shared/protocol/src/index.ts 后同步此文件。

enum ToolKind {
  auto,
  grok,
  claude,
  dsh,
  cursor,
  cursorAgent,
  svn,
  workbuddy,
  codex,
  file,
}

enum TaskStatus {
  queued,
  running,
  awaitingConfirm,
  completed,
  failed,
  cancelled,
}

enum OutputKind { stdout, stderr, info, tool, markdown }

enum MessageType {
  hello,
  pairStart,
  pairComplete,
  authToken,
  agentStatus,
  taskCreate,
  taskOutput,
  taskStatus,
  taskConfirmRequest,
  taskConfirmResponse,
  taskCancel,
  taskCatchup,
  fileOffer,
  error,
}

class WireMessage {
  WireMessage({
    required this.id,
    required this.ts,
    required this.type,
    required this.role,
    required this.payload,
  });

  final String id;
  final int ts;
  final MessageType type;
  final String role;
  final Map<String, dynamic> payload;

  factory WireMessage.fromJson(Map<String, dynamic> json) {
    return WireMessage(
      id: json['id'] as String,
      ts: json['ts'] as int,
      type: _messageTypeFromWire(json['type'] as String),
      role: json['role'] as String,
      payload: Map<String, dynamic>.from(json['payload'] as Map),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'ts': ts,
        'type': _messageTypeToWire(type),
        'role': role,
        'payload': payload,
      };

  static MessageType _messageTypeFromWire(String s) {
    switch (s) {
      case 'pair.start':
        return MessageType.pairStart;
      case 'pair.complete':
        return MessageType.pairComplete;
      case 'auth.token':
        return MessageType.authToken;
      case 'agent.status':
        return MessageType.agentStatus;
      case 'task.create':
        return MessageType.taskCreate;
      case 'task.output':
        return MessageType.taskOutput;
      case 'task.status':
        return MessageType.taskStatus;
      case 'task.confirm.request':
        return MessageType.taskConfirmRequest;
      case 'task.confirm.response':
        return MessageType.taskConfirmResponse;
      case 'task.cancel':
        return MessageType.taskCancel;
      case 'task.catchup':
        return MessageType.taskCatchup;
      case 'file.offer':
        return MessageType.fileOffer;
      default:
        if (s == 'hello') return MessageType.hello;
        return MessageType.error;
    }
  }

  static String _messageTypeToWire(MessageType t) {
    switch (t) {
      case MessageType.pairStart:
        return 'pair.start';
      case MessageType.pairComplete:
        return 'pair.complete';
      case MessageType.authToken:
        return 'auth.token';
      case MessageType.agentStatus:
        return 'agent.status';
      case MessageType.taskCreate:
        return 'task.create';
      case MessageType.taskOutput:
        return 'task.output';
      case MessageType.taskStatus:
        return 'task.status';
      case MessageType.taskConfirmRequest:
        return 'task.confirm.request';
      case MessageType.taskConfirmResponse:
        return 'task.confirm.response';
      case MessageType.taskCancel:
        return 'task.cancel';
      case MessageType.taskCatchup:
        return 'task.catchup';
      case MessageType.fileOffer:
        return 'file.offer';
      case MessageType.hello:
        return 'hello';
      case MessageType.error:
        return 'error';
    }
  }
}
