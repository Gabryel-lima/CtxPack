// Dart controller fixture responsible for orchestration.

import 'user_service.dart';

class UserController {
  final UserService service = UserService();

  Future<bool> handleCreate(String name) async {
    return service.create(name);
  }
}