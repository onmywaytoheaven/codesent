import * as vscode from 'vscode';
import archiver from 'archiver';
import * as stream from 'stream';
import axios from 'axios';
import FormData from 'form-data';

/**
 * Compresses the specified directory into a ZIP archive and returns it as a Buffer.
 * @param source Directory path to compress.
 * @returns Promise resolving to a Buffer containing the ZIP archive.
 */
async function zipDirectoryToBuffer(source: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const archive = archiver('zip', { zlib: { level: 9 } });
        const passthrough = new stream.PassThrough();
        const chunks: Buffer[] = [];

        archive.on('error', (err) => reject(err));

        passthrough.on('data', (chunk) => chunks.push(chunk));
        passthrough.on('end', () => resolve(Buffer.concat(chunks)));

        archive.directory(source, false);
        archive.pipe(passthrough);
        archive.finalize();
    });
}

/**
 * Uploads the ZIP archive buffer to the CodeSent API.
 * @param zipBuffer Buffer containing the ZIP archive.
 * @param apiUrl Base URL of the CodeSent API.
 * @param apiKey API key for authorization.
 * @returns Promise resolving to the Proxy UUID.
 */
async function uploadZip(zipBuffer: Buffer, apiUrl: string, apiKey: string): Promise<string> {
    const formData = new FormData();
    formData.append('file', zipBuffer, {
        filename: 'proxy.zip',
        contentType: 'application/zip',
    });

    const response = await axios.post(`${apiUrl}/upload`, formData, {
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            ...formData.getHeaders(),
        },
        validateStatus: function (status) {
            return true; // Resolve all HTTP status codes
        }
    });

    if (response.status === 200) {
        const proxyUuid = response.data.proxy_uuid;
        return proxyUuid;
    } else if (response.status === 401) {
        throw new Error(`Invalid API Key`);
    } else {
        const errorMessage = response.data.error || 'Unknown error';
        throw new Error(`File upload failed: ${errorMessage}`);
    }
}

/**
 * Initiates validation for the uploaded proxy.
 * @param proxyUuid Proxy UUID obtained from the upload.
 * @param apiUrl Base URL of the CodeSent API.
 * @param apiKey API key for authorization.
 * @returns Promise resolving to the Task UUID.
 */
async function validateProxy(proxyUuid: string, apiUrl: string, apiKey: string): Promise<string> {
    const response = await axios.post(`${apiUrl}/${proxyUuid}/validate`, {}, {
        headers: {
            'Authorization': `Bearer ${apiKey}`,
        },
        validateStatus: function (status) {
            return true; // Resolve all HTTP status codes
        }
    });

    if (response.status === 200) {
        const taskUuid = response.data.task_uuid;
        return taskUuid;
    } else if (response.status === 401) {
        throw new Error(`Invalid API Key`);
    } else {
        const errorMessage = response.data.error || 'Unknown error';
        throw new Error(`Validation initiation failed: ${errorMessage}`);
    }
}

/**
 * Checks the current status of the validation task.
 * @param proxyUuid Proxy UUID.
 * @param taskUuid Task UUID.
 * @param apiUrl Base URL of the CodeSent API.
 * @param apiKey API key for authorization.
 * @returns Promise resolving to the current status.
 */
async function checkStatus(proxyUuid: string, taskUuid: string, apiUrl: string, apiKey: string): Promise<string> {
    const response = await axios.post(`${apiUrl}/${proxyUuid}/${taskUuid}/status`, {}, {
        headers: {
            'Authorization': `Bearer ${apiKey}`,
        },
        validateStatus: function (status) {
            return true; // Resolve all HTTP status codes
        }
    });

    if (response.status === 200) {
        const status = response.data.status;
        return status;
    } else if (response.status === 401) {
        throw new Error(`Invalid API Key`);
    } else {
        const errorMessage = response.data.error || 'Unknown error';
        throw new Error(`Status check failed: ${errorMessage}`);
    }
}

/**
 * Retrieves the results of the completed validation task.
 * @param proxyUuid Proxy UUID.
 * @param taskUuid Task UUID.
 * @param apiUrl Base URL of the CodeSent API.
 * @param apiKey API key for authorization.
 * @returns Promise resolving to the validation results.
 */
async function getResults(proxyUuid: string, taskUuid: string, apiUrl: string, apiKey: string): Promise<any> {
    const response = await axios.post(`${apiUrl}/${proxyUuid}/${taskUuid}/results`, {}, {
        headers: {
            'Authorization': `Bearer ${apiKey}`,
        },
        validateStatus: function (status) {
            return true; // Resolve all HTTP status codes
        }
    });

    if (response.status === 200) {
        const results = response.data;
        return results;
    } else if (response.status === 401) {
        throw new Error(`Invalid API Key`);
    } else {
        const errorMessage = response.data.error || 'Unknown error';
        throw new Error(`Results retrieval failed: ${errorMessage}`);
    }
}

/**
 * Opens the SAST report URL in the default external browser.
 * @param reportUrl URL of the online report.
 */
async function openReportInBrowser(reportUrl: string) {
    const uri = vscode.Uri.parse(reportUrl);
    await vscode.env.openExternal(uri);
}

/**
 * Checks if the current workspace is an Apigee project based on detection rules.
 * @returns Promise resolving to true if Apigee project is detected, else false.
 */
async function isApigeeProject(): Promise<boolean> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return false;
    }

    const workspacePath = workspaceFolders[0].uri.fsPath;

    // 1. Check if 'apiproxy' folder exists at the root
    const apiproxyPath = vscode.Uri.joinPath(vscode.Uri.file(workspacePath), 'apiproxy');
    const apiproxyExists = await folderExists(apiproxyPath);

    if (apiproxyExists) {
        return true;
    }

    // 2. If 'apiproxy' doesn't exist, assume current workspace is inside 'apiproxy' and check for 'proxies' folder
    const proxiesPath = vscode.Uri.joinPath(vscode.Uri.file(workspacePath), 'proxies');
    const proxiesExists = await folderExists(proxiesPath);

    return proxiesExists;
}

/**
 * Checks if a folder exists at the given URI.
 * @param uri URI of the folder to check.
 * @returns Promise resolving to true if folder exists, else false.
 */
async function folderExists(uri: vscode.Uri): Promise<boolean> {
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        return stat.type === vscode.FileType.Directory;
    } catch (error) {
        return false;
    }
}

/**
 * Retrieves the API Key from Secret Storage.
 * @returns Promise resolving to the API Key string or undefined.
 */
async function getApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
    const storedApiKey = await context.secrets.get('codesentScanner.apiKey');
    return storedApiKey;
}

/**
 * Prompts the user to input the API Key and stores it securely.
 * @returns Promise resolving to the API Key string or undefined.
 */
async function promptForApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
    const apiKey = await vscode.window.showInputBox({
        prompt: 'Enter your CodeSent API Key',
        password: true, // Masks the input
        ignoreFocusOut: true,
    });

    if (apiKey) {
        await context.secrets.store('codesentScanner.apiKey', apiKey);
        vscode.window.showInformationMessage('API Key stored successfully.');
        return apiKey;
    } else {
        vscode.window.showErrorMessage('API Key entry was canceled.');
        return undefined;
    }
}

/**
 * Activates the extension.
 * @param context Extension context.
 */
export async function activate(context: vscode.ExtensionContext) {
    console.log('CodeSent for Apigee extension is now active!');

    // Create an Output Channel for logging
    const outputChannel = vscode.window.createOutputChannel('CodeSent for Apigee');
    context.subscriptions.push(outputChannel);

    // Variable to hold the status bar item
    let statusBarItem: vscode.StatusBarItem | undefined;

    // Flag to track if the scan prompt has been shown
    let hasPromptedScan = false;

    /**
     * Creates and shows the status bar item.
     */
    function showStatusBarItem() {
        if (!statusBarItem) {
            statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1);
            statusBarItem.text = '$(search) Scan Apigee Proxy';
            statusBarItem.tooltip = 'Scan Apigee Proxy with CodeSent';
            statusBarItem.command = 'codesentScanner.scanProxy';
            statusBarItem.show();
            context.subscriptions.push(statusBarItem);
            outputChannel.appendLine('Status bar item created.');
        }
    }

    /**
     * Hides and disposes the status bar item.
     */
    function hideStatusBarItem() {
        if (statusBarItem) {
            statusBarItem.hide();
            statusBarItem.dispose();
            statusBarItem = undefined;
            outputChannel.appendLine('Status bar item disposed.');
        }
    }

    /**
     * Initializes the extension by checking if the workspace is an Apigee project.
     */
    async function initialize() {
        const isApigee = await isApigeeProject();
        outputChannel.appendLine(`Apigee project detected: ${isApigee}`);
        if (isApigee) {
            showStatusBarItem();

            if (!hasPromptedScan) {
                const message = 'Apigee proxy detected. Do you want to perform a CodeSent scan?';
                const options: string[] = ['Start Scan'];

                const selected = await vscode.window.showInformationMessage(message, ...options);

                if (selected === 'Start Scan') {
                    outputChannel.appendLine('User opted to start the scan.');
                    await vscode.commands.executeCommand('codesentScanner.scanProxy');
                } else {
                    outputChannel.appendLine('User declined to start the scan.');
                }

                hasPromptedScan = true;
            }
        } else {
            hideStatusBarItem();
            hasPromptedScan = false;
        }
    }

    // Listen for workspace folder changes
    const workspaceChangeDisposable = vscode.workspace.onDidChangeWorkspaceFolders(async () => {
        outputChannel.appendLine('Workspace folders changed. Re-evaluating project type...');
        await initialize();
    });

    context.subscriptions.push(workspaceChangeDisposable);

    /**
     * Registers the 'Scan Apigee Proxy with CodeSent' command.
     */
    let scanProxyDisposable = vscode.commands.registerCommand('codesentScanner.scanProxy', async () => {
        outputChannel.appendLine('scanProxy command invoked.');

        let apiKey = await getApiKey(context);

        if (!apiKey) {
            outputChannel.appendLine('API Key not found. Prompting user to enter it.');
            // Prompt the user to enter the API Key if it's not set
            apiKey = await promptForApiKey(context);
            if (!apiKey) {
                // If the user cancels the input, abort the command
                outputChannel.appendLine('User canceled API Key entry. Aborting scan.');
                return;
            }
        }

        const apiUrl = vscode.workspace.getConfiguration('codesentScanner').get<string>('baseUrl', 'https://codesent.io/api/scan/v1');
        outputChannel.appendLine(`Using API URL: ${apiUrl}`);

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder is open.');
            outputChannel.appendLine('Scan aborted: No workspace folder is open.');
            return;
        }

        const workspacePath = workspaceFolders[0].uri.fsPath;
        outputChannel.appendLine(`Workspace Path: ${workspacePath}`);

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Scanning Apigee Proxy with CodeSent",
                cancellable: false
            }, async (progress) => {
                outputChannel.appendLine('Starting scan process...');
                
                progress.report({ message: "Creating ZIP archive..." });
                outputChannel.appendLine('Creating ZIP archive...');
                const zipBuffer = await zipDirectoryToBuffer(workspacePath);
                outputChannel.appendLine('ZIP archive created successfully.');

                progress.report({ message: "Uploading ZIP archive..." });
                outputChannel.appendLine('Uploading ZIP archive...');
                const proxyUuid = await uploadZip(zipBuffer, apiUrl, apiKey);
                outputChannel.appendLine(`ZIP archive uploaded. Proxy UUID: ${proxyUuid}`);

                progress.report({ message: "Initiating validation..." });
                outputChannel.appendLine('Initiating validation...');
                const taskUuid = await validateProxy(proxyUuid, apiUrl, apiKey);
                outputChannel.appendLine(`Validation initiated. Task UUID: ${taskUuid}`);

                // Periodically check the status
                let status = '';
                while (true) {
                    status = await checkStatus(proxyUuid, taskUuid, apiUrl, apiKey);
                    outputChannel.appendLine(`Current status: ${status}`);
                    if (status.toLowerCase() === 'done') {
                        break;
                    } else if (['failed', 'error'].includes(status.toLowerCase())) {
                        throw new Error('Validation completed with errors.');
                    }
                    progress.report({ message: `Current status: ${status}` });
                    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for 5 seconds
                }

                progress.report({ message: "Retrieving validation results..." });
                outputChannel.appendLine('Retrieving validation results...');
                const results = await getResults(proxyUuid, taskUuid, apiUrl, apiKey);
                outputChannel.appendLine('Validation results retrieved.');

                // Show a notification with action buttons
                const reportUrl: string = results.online_report;
                const message = 'SAST scan completed successfully.';
                const options: string[] = ['Copy Report URL', 'Open in Browser'];

                const selected = await vscode.window.showInformationMessage(message, ...options);
                outputChannel.appendLine(`User selected option: ${selected}`);

                if (selected === 'Copy Report URL') {
                    await vscode.env.clipboard.writeText(reportUrl);
                    vscode.window.showInformationMessage('Report URL copied to clipboard.');
                    outputChannel.appendLine('Report URL copied to clipboard.');
                } else if (selected === 'Open in Browser') {
                    await openReportInBrowser(reportUrl);
                    vscode.window.showInformationMessage('Report opened in browser.');
                    outputChannel.appendLine('Report opened in browser.');
                }

                // Log completion
                outputChannel.appendLine('SAST scan completed successfully.');
            });
        } catch (error: any) {
            if (error.response) {
                // Server responded with a status other than 2xx
                vscode.window.showErrorMessage(`Server Error: ${error.response.data.message || error.message}`);
                outputChannel.appendLine(`Server Error: ${error.response.data.message || error.message}`);
            } else if (error.request) {
                // No response received
                vscode.window.showErrorMessage('No response from the server. Please check your internet connection.');
                outputChannel.appendLine('No response from the server. Please check your internet connection.');
            } else {
                // Other errors
                vscode.window.showErrorMessage(`An error occurred: ${error.message}`);
                outputChannel.appendLine(`An error occurred: ${error.message}`);
            }
        }
    });

    context.subscriptions.push(scanProxyDisposable);

    /**
     * Registers the 'Set CodeSent API Key' command.
     */
    let setApiKeyDisposable = vscode.commands.registerCommand('codesentScanner.setApiKey', async () => {
        const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your CodeSent API Key',
            password: true, // Masks the input
            ignoreFocusOut: true,
        });

        if (apiKey) {
            await context.secrets.store('codesentScanner.apiKey', apiKey);
            vscode.window.showInformationMessage('API Key stored successfully.');
            outputChannel.appendLine('API Key stored successfully.');
        } else {
            vscode.window.showErrorMessage('API Key entry was canceled.');
            outputChannel.appendLine('API Key entry was canceled.');
        }
    });

    context.subscriptions.push(setApiKeyDisposable);

    /**
     * Registers the 'Delete CodeSent API Key' command.
     */
    let deleteApiKeyDisposable = vscode.commands.registerCommand('codesentScanner.deleteApiKey', async () => {
        const apiKey = await getApiKey(context);
        if (!apiKey) {
            vscode.window.showInformationMessage('API Key is not set.');
            outputChannel.appendLine('Delete operation: No API Key to delete.');
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            'Are you sure you want to delete your CodeSent API Key?',
            { modal: true },
            'Yes',
            'No'
        );

        if (confirm === 'Yes') {
            await context.secrets.delete('codesentScanner.apiKey');
            vscode.window.showInformationMessage('API Key has been deleted.');
            outputChannel.appendLine('API Key has been deleted.');
        } else {
            vscode.window.showInformationMessage('API Key deletion canceled.');
            outputChannel.appendLine('API Key deletion canceled.');
        }
    });

    context.subscriptions.push(deleteApiKeyDisposable);
    
    // Initial check when the extension is activated
    await initialize();
}

/**
 * Deactivates the extension.
 */
export function deactivate() { }
