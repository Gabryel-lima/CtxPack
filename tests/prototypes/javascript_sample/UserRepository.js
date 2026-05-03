// Repository abstraction for fixture data persistence.

export class UserRepository {
  save(payload) {
    return { id: 1, ...payload };
  }
}