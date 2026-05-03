"""HTTP entrypoint coordinating handlers and background jobs."""

from service import bootstrap


class App:
    def run(self, host: str, port: int) -> None:
        bootstrap(host, port)


def main() -> None:
    app = App()
    app.run("0.0.0.0", 8080)


if __name__ == "__main__":
    main()