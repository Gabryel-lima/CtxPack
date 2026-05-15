<!-- DSL SEMANTIC: PRJ=project, DEP=dependencies, MOD=module, REL=module relations, CONV=conventions, DEC=design decisions, BUG=known issues, NOW=current focus, CTX=extra context -->

PRJ:python_sample|lang:Python
MOD:app|file:app.py|role:application root|state:done
  CLASS:App
    FUNC:run(self, host: str, port: int)
  FUNC:main()
MOD:service|file:service.py|role:business logic|state:planned
  CLASS:UserService
    FUNC:create_user(self, name: str)
  FUNC:bootstrap(host: str, port: int)
REL:app->service|via:service
CONV:PascalCase
CTX:app.py: HTTP entrypoint coordinating handlers and background jobs.
CTX:service.py: Business service exposing bootstrap operations.

---
## SEMANTIC PACK SUMMARY
- Estimated tokens: ~168
- Output size: ~0 KB
