import * as vscode from 'vscode';
import archiver from 'archiver'; // Default import
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';
import FormData from 'form-data'; // Import FormData

/**
 * Compresses the specified directory into a ZIP file stored in a temporary location.
 * @param source Directory path to compress.
 * @param outPath Output path for the ZIP file.
 */
async function zipDirectory(source: string, outPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => resolve());
        archive.on('error', (err) => reject(err));

        archive.pipe(output);
        archive.directory(source, false);
        archive.finalize();
    });
}

/**
 * Uploads the ZIP file to the CodeSent API.
 * @param zipPath Path to the ZIP file.
 * @param apiUrl Base URL of the CodeSent API.
 * @param apiKey API key for authorization.
 * @returns Proxy UUID as a string.
 */
async function uploadZip(zipPath: string, apiUrl: string, apiKey: string): Promise<string> {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(zipPath));

    const response = await axios.post(`${apiUrl}/upload`, formData, {
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            ...formData.getHeaders(),
        }
    });

    if (response.status === 200) {
        const proxyUuid = response.data.proxy_uuid;
        vscode.window.showInformationMessage(`File uploaded successfully. Proxy UUID: ${proxyUuid}`);
        return proxyUuid;
    } else {
        const errorMessage = response.data.response || 'Unknown error';
        throw new Error(`File upload failed: ${errorMessage}`);
    }
}

/**
 * Initiates validation for the uploaded proxy.
 * @param proxyUuid Proxy UUID obtained from the upload.
 * @param apiUrl Base URL of the CodeSent API.
 * @param apiKey API key for authorization.
 * @returns Task UUID as a string.
 */
async function validateProxy(proxyUuid: string, apiUrl: string, apiKey: string): Promise<string> {
    const response = await axios.post(`${apiUrl}/${proxyUuid}/validate`, {}, {
        headers: {
            'Authorization': `Bearer ${apiKey}`,
        }
    });

    if (response.status === 200) {
        const taskUuid = response.data.task_uuid;
        vscode.window.showInformationMessage(`Validation initiated. Task UUID: ${taskUuid}`);
        return taskUuid;
    } else {
        const errorMessage = response.data.response || 'Unknown error';
        throw new Error(`Validation initiation failed: ${errorMessage}`);
    }
}

/**
 * Checks the current status of the validation task.
 * @param proxyUuid Proxy UUID.
 * @param taskUuid Task UUID.
 * @param apiUrl Base URL of the CodeSent API.
 * @param apiKey API key for authorization.
 * @returns Current status as a string.
 */
async function checkStatus(proxyUuid: string, taskUuid: string, apiUrl: string, apiKey: string): Promise<string> {
    const response = await axios.post(`${apiUrl}/${proxyUuid}/${taskUuid}/status`, {}, {
        headers: {
            'Authorization': `Bearer ${apiKey}`,
        }
    });

    if (response.status === 200) {
        const status = response.data.status;
        return status;
    } else {
        const errorMessage = response.data.response || 'Unknown error';
        throw new Error(`Status check failed: ${errorMessage}`);
    }
}

/**
 * Retrieves the results of the completed validation task.
 * @param proxyUuid Proxy UUID.
 * @param taskUuid Task UUID.
 * @param apiUrl Base URL of the CodeSent API.
 * @param apiKey API key for authorization.
 * @returns Validation results.
 */
async function getResults(proxyUuid: string, taskUuid: string, apiUrl: string, apiKey: string): Promise<any> {
    const response = await axios.post(`${apiUrl}/${proxyUuid}/${taskUuid}/results`, {}, {
        headers: {
            'Authorization': `Bearer ${apiKey}`,
        }
    });

    if (response.status === 200) {
        const results = response.data;
        return results;
    } else {
        const errorMessage = response.data.response || 'Unknown error';
        throw new Error(`Results retrieval failed: ${errorMessage}`);
    }
}

/**
 * Displays the SAST report in a Webview panel.
 * @param reportUrl URL of the online report.
 */
async function showReport(reportUrl: string) {
    const panel = vscode.window.createWebviewPanel(
        'sastReport',
        'SAST Report',
        vscode.ViewColumn.One,
        { enableScripts: true }
    );

    panel.webview.html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>SAST Report</title>
            <style>
                body, html {
                    margin: 0;
                    padding: 0;
                    height: 100%;
                    width: 100%;
                }
                iframe {
                    border: none;
                    width: 100%;
                    height: 100%;
                }
            </style>
        </head>
        <body>
            <iframe src="${reportUrl}"></iframe>
        </body>
        </html>
    `;
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

    // Function to get the API Key from Secret Storage
    async function getApiKey(): Promise<string | undefined> {
        const storedApiKey = await context.secrets.get('codesentScanner.apiKey');
        return storedApiKey;
    }

    // Register the main scan command
    let scanProxyDisposable = vscode.commands.registerCommand('codesentScanner.scanProxy', async () => {
        const apiKey = await getApiKey();
        if (!apiKey) {
            vscode.window.showErrorMessage('API key is not set. Please set it using the "CodeSent: Set API Key" command.');
            outputChannel.appendLine('Scan aborted: API key not set.');
            return;
        }

        const apiUrl = vscode.workspace.getConfiguration('codesentScanner').get<string>('baseUrl', 'https://codesent.io/api/scan/v1');

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder found.');
            outputChannel.appendLine('Scan aborted: No workspace folder.');
            return;
        }

        const workspacePath = workspaceFolders[0].uri.fsPath;
        const zipPath = path.join(os.tmpdir(), 'proxy.zip');

        try {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Scanning Apigee Proxy with CodeSent SAST...",
                cancellable: false
            }, async (progress) => {
                progress.report({ message: "Zipping the proxy directory..." });
                outputChannel.appendLine('Zipping the proxy directory...');
                await zipDirectory(workspacePath, zipPath);

                progress.report({ message: "Uploading ZIP file..." });
                outputChannel.appendLine('Uploading ZIP file...');
                const proxyUuid = await uploadZip(zipPath, apiUrl, apiKey);

                progress.report({ message: "Initiating validation..." });
                outputChannel.appendLine('Initiating validation...');
                const taskUuid = await validateProxy(proxyUuid, apiUrl, apiKey);

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

                // Display the report to the user
                await showReport(results.online_report);
                vscode.window.showInformationMessage('SAST scan completed successfully.');
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
        } finally {
            // Remove the temporary ZIP file
            await fs.remove(zipPath);
            outputChannel.appendLine('Temporary ZIP file removed.');
        }
    });

    context.subscriptions.push(scanProxyDisposable);

    // Register the set API key command
    let setApiKeyDisposable = vscode.commands.registerCommand('codesentScanner.setApiKey', async () => {
        const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your CodeSent API Key',
            password: true, // Masks the input
            ignoreFocusOut: true
        });

        if (apiKey) {
            await context.secrets.store('codesentScanner.apiKey', apiKey);
            vscode.window.showInformationMessage('API Key stored successfully.');
            outputChannel.appendLine('API Key stored successfully.');
        } else {
            vscode.window.showErrorMessage('API Key entry canceled.');
            outputChannel.appendLine('API Key entry canceled.');
        }
    });

    context.subscriptions.push(setApiKeyDisposable);

    // Create a status bar item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(search) Scan Apigee Proxy'; // Icon and text
    statusBarItem.tooltip = 'Scan Apigee Proxy with CodeSent SAST';
    statusBarItem.command = 'codesentScanner.scanProxy';
    statusBarItem.show();

    context.subscriptions.push(statusBarItem);
}

/**
 * Deactivates the extension.
 */
export function deactivate() { }
