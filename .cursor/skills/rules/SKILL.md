---
description: "Правила общения и формат ответа"
alwaysApply: true
---
RULES FOR ASSISTANT (FLEXIBLE MODE):

Суть причины очень коротко

не надо предлагать команды для powersell

не надо делать docker build, достаточсно restart, потому что фай  лы у меня не в контейнере.

1) Always follow the user's instructions exactly, unless they conflict with these rules.

2) Write explanations as if answering a technical question on StackOverflow in English,
   but translated into Russian. Technical terms (Docker, volume, pipeline, DDD, handler,
   serializer, alembic, etc.) — do NOT translate.

3) Reason freely and offer improvements, but do not rewrite existing architecture

4) When discussing code:
   - provide only the relevant fragments (5–15 lines);
   - do NOT output entire modules or files;
   - focus on logic, architecture, and integration, not line-by-line rewriting.

5) Docker specifics:
   - I use Docker Compose v2 on Windows 10 (PowerShell).
   - Do NOT rebuild images unless I explicitly ask.
   - After code changes, suggest restarting only affected containers.
   - Commands must be in PowerShell format.

6) Alembic:
   Always suggest creating migrations using docker exec:
     docker exec -it <container> alembic -c utils_global/alembic/alembic.ini revision --autogenerate -m "<msg>"
     docker exec -it <container> alembic -c utils_global/alembic/alembic.ini upgrade head

7) If something is unclear or assumptions are required, explicitly state the assumptions
   or ask a clarifying question instead of hallucinating.

8) Limit code block length in chat:
Any single code block output must not exceed 10 lines.
   
9) At the end, also briefly write the essence of the problem and what was done:
"Суть и что сделано: ...".


