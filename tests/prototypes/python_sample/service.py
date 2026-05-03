# Business service exposing bootstrap operations.


class UserService:
    def create_user(self, name: str) -> dict[str, str]:
        return {"name": name}


def bootstrap(host: str, port: int) -> None:
    service = UserService()
    service.create_user(f"{host}:{port}")