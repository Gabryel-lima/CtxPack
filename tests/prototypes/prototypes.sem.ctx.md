<!-- DSL SEMANTIC: PRJ=project, DEP=dependencies, MOD=module, REL=module relations, CONV=conventions, DEC=design decisions, BUG=known issues, NOW=current focus, CTX=extra context -->

PRJ:prototypes|lang:C,C#,C++,Dart,Go,Java,JavaScript,Kotlin,Lua,PHP,Python,Ruby,Rust,Shell,Swift,TypeScript
MOD:cpp_sample/engine|file:cpp_sample/engine.cpp|role:cpp_sample module|state:planned
  CLASS:Engine
    FUNC:Engine()
    FUNC:renderFrame(int frameIndex)
  FUNC:buildFrame(int frameIndex)
MOD:csharp_sample/UserController|file:csharp_sample/UserController.cs|role:control logic, flow|state:done
  CLASS:UserController
    FUNC:HandleCreate(string name)
MOD:csharp_sample/UserService|file:csharp_sample/UserService.cs|role:business logic|state:done
  CLASS:UserService
    FUNC:Create(string name)
MOD:dart_sample/user_controller|file:dart_sample/user_controller.dart|role:control logic, flow|state:planned
  CLASS:UserController
    FUNC:handleCreate(String name)
MOD:dart_sample/user_service|file:dart_sample/user_service.dart|role:business logic|state:planned
  CLASS:UserService
    FUNC:create(String name)
MOD:go_sample/server|file:go_sample/server.go|role:server, listener|state:done
  CLASS:Server
    FUNC:Start()
  FUNC:NewServer(addr string)
  FUNC:bootstrap(addr string)
MOD:java_sample/UserController|file:java_sample/UserController.java|role:control logic, flow|state:done
  CLASS:UserController
    FUNC:handleCreate(String name)
  CLASS:UserService
    FUNC:create(String name)
MOD:javascript_sample/service|file:javascript_sample/service.js|role:business logic|state:done
  CLASS:UserService
    FUNC:constructor()
    FUNC:createUser(name, email)
  FUNC:bootstrap(seedName)
MOD:javascript_sample/UserRepository|file:javascript_sample/UserRepository.js|role:data access, persistence|state:planned
  CLASS:UserRepository
    FUNC:save(payload)
MOD:kotlin_sample/SyncUseCase|file:kotlin_sample/SyncUseCase.kt|role:kotlin_sample module|state:planned
  CLASS:SyncUseCase
    FUNC:execute(input: String)
  FUNC:normalize(input: String)
MOD:lua_sample/parser|file:lua_sample/parser.lua|role:parsing, format interpretation|state:planned
  CLASS:Parser
    FUNC:normalize(input)
MOD:lua_sample/worker|file:lua_sample/worker.lua|role:lua_sample module|state:planned
  CLASS:Worker
    FUNC:run(input)
MOD:php_sample/UserController|file:php_sample/UserController.php|role:control logic, flow|state:done
  CLASS:UserController
    FUNC:handleCreate(string $name)
MOD:php_sample/UserService|file:php_sample/UserService.php|role:business logic|state:planned
  CLASS:UserService
    FUNC:create(string $name)
MOD:python_sample/app|file:python_sample/app.py|role:application root|state:done
  CLASS:App
    FUNC:run(self, host: str, port: int)
  FUNC:main()
MOD:python_sample/service|file:python_sample/service.py|role:business logic|state:planned
  CLASS:UserService
    FUNC:create_user(self, name: str)
  FUNC:bootstrap(host: str, port: int)
MOD:ruby_sample/app|file:ruby_sample/app.rb|role:application root|state:planned
  CLASS:App
    FUNC:run(name)
MOD:ruby_sample/service|file:ruby_sample/service.rb|role:business logic|state:planned
  CLASS:Service
    FUNC:call(name)
    FUNC:normalize(name)
MOD:rust_sample/parser|file:rust_sample/parser.rs|role:parsing, format interpretation|state:done
  CLASS:CommandParser
    FUNC:new(prefix: &str)
    FUNC:parse(&self, input: &str)
  FUNC:normalize(input: &str)
MOD:shell_sample/deploy|file:shell_sample/deploy.sh|role:shell_sample module|state:done
  FUNC:deploy()
  FUNC:run_checks()
  FUNC:main()
MOD:swift_sample/SyncService|file:swift_sample/SyncService.swift|role:business logic|state:done
  CLASS:SyncPayload
  CLASS:SyncService
    FUNC:execute(payload: SyncPayload)
    FUNC:normalize(_ value: String)
MOD:typescript_sample/controller|file:typescript_sample/controller.ts|role:control logic, flow|state:done
  CLASS:UserController
    FUNC:handleCreate(name: string)
  FUNC:createUser(name: string)
MOD:README|file:README.md|role:prototypes module|state:done
REL:dart_sample/user_controller->dart_sample/user_service|via:user_service.dart
REL:javascript_sample/service->javascript_sample/UserRepository|via:./UserRepository
REL:lua_sample/worker->lua_sample/parser|via:parser
REL:php_sample/UserController->php_sample/UserService|via:/UserService.php
REL:python_sample/app->python_sample/service|via:service
REL:ruby_sample/app->ruby_sample/service|via:service
REL:typescript_sample/controller->javascript_sample/service|via:../javascript_sample/service
CONV:PascalCase
CTX:cpp_sample/engine.cpp: Engine implementation fixture that exercises C++ function extraction.
CTX:csharp_sample/UserController.cs: C# controller fixture coordinating service calls.
CTX:csharp_sample/UserService.cs: C# service fixture covering class and method extraction.
CTX:dart_sample/user_controller.dart: Dart controller fixture responsible for orchestration.
CTX:dart_sample/user_service.dart: Dart service fixture covering class and method extraction.
CTX:go_sample/server.go: Go server fixture with router-style methods and startup entrypoint.
CTX:java_sample/UserController.java: Java controller fixture that coordinates request handlers and services.
CTX:javascript_sample/service.js: JavaScript service module that wires repository access and startup flow.
CTX:javascript_sample/UserRepository.js: Repository abstraction for fixture data persistence.
CTX:kotlin_sample/SyncUseCase.kt: Kotlin use case fixture used to validate semantic symbol extraction.
CTX:lua_sample/parser.lua: Lua parser fixture focused on token normalization.
CTX:lua_sample/worker.lua: Lua worker fixture that depends on the parser module.
CTX:php_sample/UserController.php: role control logic, flow; classes UserController; functions handleCreate
CTX:php_sample/UserService.php: role business logic; classes UserService; functions create
CTX:python_sample/app.py: HTTP entrypoint coordinating handlers and background jobs.
CTX:python_sample/service.py: Business service exposing bootstrap operations.
CTX:ruby_sample/app.rb: Ruby entrypoint fixture for semantic extraction.
CTX:ruby_sample/service.rb: Ruby service fixture that models domain work.
CTX:rust_sample/parser.rs: Rust parser fixture focused on tokenization and command parsing.
CTX:shell_sample/deploy.sh: Shell deployment fixture with orchestration helpers.
CTX:swift_sample/SyncService.swift: Swift synchronization fixture with an extension and instance methods.
CTX:typescript_sample/controller.ts: TypeScript controller responsible for HTTP orchestration.
CTX:README.md: Polyglot semantic fixtures

---
## SEMANTIC PACK SUMMARY
- Estimated tokens: ~1,644
- Output size: ~6 KB
