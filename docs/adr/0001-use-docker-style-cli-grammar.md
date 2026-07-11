# Use Docker-style object-action CLI grammar

CCX will organize canonical commands as `ccx <object> <action>`, using consistent lifecycle verbs such as `create`, `ls`, `inspect`, `update`, and `rm`, plus `--from-*` options for derived state. High-frequency project commands may have top-level aliases, while legacy ambiguous commands remain only for a bounded deprecation period; this trades some migration work for a predictable interface that scales without argument-count routing.
