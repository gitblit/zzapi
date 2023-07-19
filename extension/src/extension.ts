import {
    ExtensionContext,
    languages,
    commands,
    window,
    StatusBarAlignment,
    StatusBarItem,
    workspace,
    Disposable,
} from "vscode";

import {
    CodelensProviderForAllReq,
    CodelensProviderForIndReq,
} from "./CodeLensProviders";

import { registerRunRequest, registerRunAllRequests } from "./registerRequests";

import * as fs from "fs";
import * as YAML from "yaml";

let disposables: Disposable[] = [];
let statusBar: StatusBarItem;

const varFile = "zz-envs.yaml";
let varFilePath: string;

//plan: export these details wherever required
let currentEnvironment: string;
let allEnvironments: any = {};

export function activate(context: ExtensionContext) {
    const activeEditor = window.activeTextEditor;
    if (activeEditor) {
        const activeEditorPath = activeEditor.document.uri.path;
        const lastIndex = activeEditorPath.lastIndexOf("/");
        varFilePath = activeEditorPath.substring(0, lastIndex + 1) + varFile;
    }

    initialiseEnvironments();
    const envChangeListener = workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.path === varFilePath) {
            initialiseEnvironments();
        }
    });
    context.subscriptions.push(envChangeListener);
    disposables.push(envChangeListener);

    statusBar = window.createStatusBarItem(StatusBarAlignment.Left);
    initialiseStatusBar(statusBar, context);

    createEnvironmentSelector(statusBar, context);

    languages.registerCodeLensProvider("*", new CodelensProviderForIndReq());
    languages.registerCodeLensProvider("*", new CodelensProviderForAllReq());

    commands.registerCommand("extension.runRequest", async (name) => {
        await registerRunRequest(name);
    });

    commands.registerCommand("extension.runAllRequests", async () => {
        await registerRunAllRequests();
    });
}

function initialiseStatusBar(
    statusBar: StatusBarItem,
    context: ExtensionContext
) {
    statusBar.text = "zzAPI: Set Environment";
    statusBar.command = "extension.clickEnvSelector";
    statusBar.show();
    context.subscriptions.push(statusBar);
    disposables.push(statusBar);
}

function createEnvironmentSelector(
    statusBar: StatusBarItem,
    context: ExtensionContext
) {
    const statusClick = commands.registerCommand(
        "extension.clickEnvSelector",
        () => {
            showEnvironmentOptions();
        }
    );
    context.subscriptions.push(statusClick);

    const showEnvironmentOptions = () => {
        window
            .showQuickPick(environmentsToDisplay, {
                placeHolder: "Select An Environment",
                matchOnDetail: true,
                matchOnDescription: true,
            })
            .then((selectedEnvironment) => {
                if (selectedEnvironment) {
                    setEnvironment(statusBar, selectedEnvironment.label);
                }
            });
    };
}

function setEnvironment(statusBar: StatusBarItem, environment: string) {
    currentEnvironment = environment;
    statusBar.text = `Current Environment: ${currentEnvironment}`;
}

let environmentsToDisplay: Array<{ label: string; description: string }> = [];

function initialiseEnvironments() {
    environmentsToDisplay = [];
    currentEnvironment = "";
    allEnvironments = [];

    if (fs.existsSync(varFilePath)) {
        const data = fs.readFileSync(varFilePath, "utf-8");
        const parsedData = YAML.parse(data);

        if (parsedData !== undefined) {
            const allEnvs = parsedData.varsets;

            if (allEnvs !== undefined && Array.isArray(allEnvs)) {
                const numEnvs = allEnvs.length;

                for (let i = 0; i < numEnvs; i++) {
                    const env = allEnvs[i];

                    const name: string = env.name;
                    const vars: Array<string> = env.vars;
                    environmentsToDisplay.push({
                        label: `${name}`,
                        description: `Set Environment: ${name} -> ${vars}`,
                    });

                    allEnvironments[name] = vars;
                }
            }
        }
    }
}

export function deactivate() {
    if (disposables) {
        disposables.forEach((item) => item.dispose());
    }
    disposables = [];

    if (statusBar) {
        statusBar.hide();
    }
}
