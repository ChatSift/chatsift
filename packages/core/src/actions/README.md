# actions

This directory contains structures responsible for dispatching moderation actions.

Unlike other constructs in this project, we do not leverage a factory pattern here, this is because
the input to each action type is different, and as such we cannot return a generic `IModAction`.

As such, each type gets its own interface, refer to the [`IModAction` file](./IModAction.ts).
