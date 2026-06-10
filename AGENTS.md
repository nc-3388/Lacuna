# Lacuna AGENTS.md instructions
## These instructions apply unless explicitly overridden by the prompt.

## Terminology:
- "Agent" refers to you, the AI, who is being given instructions on how to respond to prompts.
- "Prompter" refers to the person who is giving you instructions and prompts to respond

## Instructions:
The instructions are as follows. These instructions are strict, which means they apply in all circumstances; later you shall see that there are some instructions that are just guidelines, which means they apply in most circumstances, but can be overridden by the agent (you) if you think it is necessary to do so. If you have any questions about these instructions, please ask the prompter for clarification.

### Compulsory Instructions:
1. Always write in British English. Never write in American English. This means that you should use British spellings, such as "colour" instead of "color", "favour" instead of "favor", and so on. This does NOT apply to code identifiers, which would mean that if the syntax of the programming language you are using requires American English, then you should use American English for code identifiers. However, for all other writing, such as comments, documentation, and user-facing text, you should use British English. This will help to ensure consistency in the language used throughout the codebase, and will also help to maintain a professional and polished appearance for the codebase.
2. Never use emojis. Emojis are a drag on the codebase, and makes things look less, rather than more, professional. If you want to express an emotion, use words to do so instead of emojis.
3. Always fix any bugs you incidentally find in the codebase, even if it takes longer to complete the task. This is because it is important to maintain a high quality codebase, and fixing bugs as you find them helps to achieve that goal. Please mention the bugs you fix, and commit them separately to the main task (no code review needed; simply add the files and commit them, and provide a summary at the end.)
4. Always write in a clear and concise manner. Avoid using unnecessary words or phrases, and get straight to the point. This will help to ensure that your responses are easy to understand and follow.
5. Before writing a plan, you should first both read the codebase, and also ask the user substantially detailed questions about any ambiguities in the task at hand if ambiguities exist. You must not ask gratuitous, obvious questions, but questions with genuine ambiguity that you need to resolve before you can write a plan. This will help to ensure that your plans are well-informed and effective, and that you have a clear understanding of the task at hand before you begin writing a plan.
6. Before implementing new functionality or giving the user bug reports or feature suggestions, search the codebase as well as the web when applicable to determine whether similar functionality already exists.
7. Prefer extending existing systems over creating parallel ones.
8. Follow existing naming conventions, file organisation, and coding style. Do not introduce a different architectural pattern unless there is a strong reason.
9. When multiple reasonable solutions exist, briefly explain the trade-offs and always ask the user which they prefer before proceeding unless there is a clearly superior option; in that case, tell the user and proceed. This will help to ensure that you are making informed decisions about how to implement new functionality, and that you are taking the user's preferences into account when making those decisions.
10. Do not implement features that were not requested. Avoid speculative improvements. If you think a feature would be a good idea, you can suggest it to the user, but you should not implement it without the user's explicit approval. This will help to ensure that you are focusing on the tasks that the user has requested, and that you are not wasting time implementing features that may not be useful or desired by the user.
11. Avoid modifying unrelated files. Minimise the size of changes whenever practical. This will reduce merge conflicts.
12. Do not remove comments unless they are incorrect, obsolete, or replaced by better documentation; if you do see an outdated comment, you should update it. Comments are an important part of the codebase, and they help to explain the purpose and functionality of different parts of the code. Removing comments can make the codebase more difficult to understand, and can lead to confusion for other developers who may be working with the code in the future.
13. Never add TODO implementations, placeholder functions, mock data, or stub behaviour unless explicitly requested.
14. Inspect the surrounding code before changing behaviour. Do not assume APIs, types, or files exist without checking.
15. Always update SPEC.md, the README.md or any other applicable documentation after any meaningful changes to reflect changes.
16. Anything you do to change the user facing interface, you must make sure it's beautifully implemented, seamless and looks native rather than bolted on as a side project. This means that if you are making changes to the user interface, you should take the time to ensure that those changes are well-designed and well-implemented, and that they fit seamlessly into the existing user interface. This will help to ensure that the user experience remains smooth and enjoyable, and that any changes you make do not feel out of place or jarring to the user. If your changes involve UI, read the frontend-design.md file and follow the principles outlined in it.
17. Never add cringe comments to the user-facing interface, such as design comments. The UI should feel minimal and intentional, and minimising the unnecessary text is essential to achieving that.

#### Quick fire rules:

- Prefer modifying existing files over creating new ones unless a new file improves organisation.
- Keep changes as small and local as possible.
- Avoid unnecessary dependencies.
- Do not refactor unrelated code.
- Explain trade-offs when there are multiple reasonable approaches.
- Preserve existing style and conventions.
- Search the codebase before assuming functionality does not already exist.
- Avoid placeholder implementations.

### Guidelines:
1. You should aim to make the codebase readable and as concise as possible. This means making surgical changes to the codebase, rather than making large, sweeping changes that may be difficult to understand. You should follow the typical developer mantra of being incredibly lazy, and writing as little code as you can to achieve the functionality, as well as reducing future pain in maintainance. I would be more appreciative if you managed to make a change by reducing the amount of code rather than increasing it.
2. When the tasks are numbered (e.g., there are a sequence of tasks that need to be completed, whether related or not), you should complete the tasks in order, as well as committing changes after each task. Before committing any changes, you MUST run a code review subagent, and you MUST fix any suggestions (however minor, even if the code is fine and it's a minor complaint about formatting or something like that) before committing. This will help to ensure that the codebase remains high quality, and that any changes you make are thoroughly reviewed and tested before being committed.
3. You must complete the ENTIRE list of tasks (if exists rather than a single, minor task) in ONE GO, except for asking questions. Do not stop after completing only the first task in a numbered list. Aim to complete the full list before handing back control, unless blocked by ambiguity or errors.
4. Prioritise performance over aesthetics; though make the trade-off clear to the prompter. This means that if there is a trade-off between making the codebase more performant, or making it more aesthetically pleasing, you should prioritise performance. However, if the performance trade-off is negligible, then you ought to prioritise aesthetics. If you incidentally find any performance issues in the codebase, you should fix them, even if they are not related to the task at hand. This will help to ensure that the codebase remains performant and efficient, and that any performance issues are addressed in a timely manner.

### Miscellaneous:
This codebase is an alpha project, and there does not exist a production version. Therefore, when asked for suggestions to improve the codebase, you should not be afraid to make large, sweeping changes that may be difficult to understand, if you think that they will significantly improve the codebase. This is because the codebase is still in its early stages, and it is more important to focus on improving the codebase than it is to maintain a high level of readability at this stage.

