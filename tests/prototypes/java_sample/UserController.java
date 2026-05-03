/* Java controller fixture that coordinates request handlers and services. */

public class UserController {
    private final UserService service = new UserService();

    public String handleCreate(String name) {
        return service.create(name);
    }
}

class UserService {
    public String create(String name) {
        return name + "-created";
    }
}