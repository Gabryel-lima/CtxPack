// Swift synchronization fixture with an extension and instance methods.

struct SyncPayload {
    let name: String
}

class SyncService {
    func execute(payload: SyncPayload) -> String {
        normalize(payload.name)
    }

    func normalize(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}