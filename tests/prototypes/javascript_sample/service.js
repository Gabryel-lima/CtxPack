// JavaScript service module that wires repository access and startup flow.

import { UserRepository } from "./UserRepository";

export class UserService {
  constructor() {
    this.repository = new UserRepository();
  }

  createUser(name, email) {
    return this.repository.save({ name, email });
  }
}

export function bootstrap(seedName) {
  const service = new UserService();
  return service.createUser(seedName, `${seedName}@example.com`);
}