// TypeScript controller responsible for HTTP orchestration.

import { bootstrap } from "../javascript_sample/service";

export class UserController {
  async handleCreate(name: string): Promise<{ ok: boolean }> {
    await bootstrap(name);
    return { ok: true };
  }
}

export async function createUser(name: string): Promise<{ ok: boolean }> {
  const controller = new UserController();
  return controller.handleCreate(name);
}