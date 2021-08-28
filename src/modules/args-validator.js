'use strict';

const MIN_NUM_ARGUMENTS = 4;
const SRC_ARG_INDEX = 2;
const TARGET_ARG_INDEX = 3;
const OPTIONS_ARG_INDEX = 4;

const Fs = require('fs');
const {ensureAbsUri, getParentPath} = require('./path-utils');
const stripJsonComments = require('strip-json-comments');

/**
 * Validates that the program was invoked with the proper arguments. SIDE EFFECT: upon successfully validation, adds
 * these values to the module's "exports" object:
 * - srcPath: contains the resolved, absolute path on disk to the <source>;
 * - targetPath: contains the resolved, absolute path on disk to the <target>;
 * - optionsData: if <options file> was given, contains the (already parsed) Object containing additional configuration.
 *   (we had to read and parse the file anyway in order to validate that it is proper JSON).
 * - srcIsDirectory: `true` if <source> path points to a folder; `undefined` when it points to a file;
 * - targetIsDirectory: `true` if <target> path points to a folder; `undefined` when it points to a non-existing file.
 *
 * @param    args
 *            Array of Strings obtained via `process.argv`.
 *
 * @param    errorCallback
 *            Function to pass descriptive error messages. It should
 *            take one string argument.
 *
 * @return    Boolean `true` if arguments passed validation, false otherwise.
 */
exports.validateArgs = function (args, errorCallback) {

    // Check that we have all required arguments
    if (args.length < MIN_NUM_ARGUMENTS) {
        errorCallback('Missing arguments');
        return false;
    }

    // PROOF THE SOURCE ARGUMENT
    // -------------------------
    // See if the <source> argument points to an existing, readable file or folder.
    const srcArg = args[SRC_ARG_INDEX];
    const srcPath = ensureAbsUri(srcArg, errorCallback, 'Invalid <source> URI: ');
    if (!srcPath) {
        return false;
    }
    if (!Fs.existsSync(srcPath)) {
        errorCallback('<source> path not found: ' + srcPath);
        return false;
    }
    try {
        Fs.accessSync(srcPath, Fs.constants.R_OK);
    } catch (e) {
        errorCallback('<source> path unreadable: ' + srcPath);
        return false;
    }
    const srcIsDirectory = Fs.lstatSync(srcPath).isDirectory();
    if (srcIsDirectory) {
        const srcDir = Fs.opendirSync(srcPath);
        const srcDirFirstEntity = srcDir.readSync();
        const isSrcDirEmpty = !srcDirFirstEntity;
        srcDir.closeSync();
        if (isSrcDirEmpty) {
            errorCallback('<source> folder is empty: ' + srcPath);
            return false;
        }
    }

    // <source> path was validated; export is as a side-effects artifact, for the outer world to use.
    exports.srcPath = srcPath;
    exports.srcIsDirectory = srcIsDirectory;

    // PROOF THE TARGET ARGUMENT
    // -------------------------
    // If the <target> argument is an existing path, then it must be a folder, and must be writeable, and must be
    // empty (the last clause can be overridden via <options>).
    const targetArg = args[TARGET_ARG_INDEX];
    const targetPath = ensureAbsUri(targetArg, errorCallback, 'Invalid <target> URI: ');
    if (!targetPath) {
        return false;
    }

    // <source> and <target> paths cannot be identical
    if (targetPath == srcPath) {
        errorCallback('<source> and <target> paths cannot be identical: ' + srcPath);
        return false;
    }

    if (Fs.existsSync(targetPath)) {
        if (!Fs.lstatSync(targetPath).isDirectory()) {
            if (srcIsDirectory) {
                errorCallback('<target> must also be a folder, when <source> is a folder: ' + targetPath);
                return false;
            }
            errorCallback('<target> file must not exist: ' + targetPath);
            return false;
        }
        try {
            Fs.accessSync(targetPath, Fs.constants.W_OK);
        } catch (e) {
            errorCallback('<target> folder unwriteable: ' + targetPath);
            return false;
        }
        const dir = Fs.opendirSync(targetPath);
        const dirFirstEntity = dir.readSync();
        const isDirEmpty = !dirFirstEntity;
        dir.closeSync();
        if (!isDirEmpty) {
            errorCallback('<target> folder not empty: ' + targetPath);
            return false;
        }
        exports.targetIsDirectory = true;
    }

    // If the <target> argument is a non existing path, then its parent folder must exist and be writeable.
    else {
        if (srcIsDirectory) {
            errorCallback ('<target> must be an existing folder, when <source> is a folder: ' + targetPath);
            return false;
        }
        const parentTargetPath = getParentPath(targetPath);
        if (!Fs.existsSync(parentTargetPath)) {
            errorCallback('parent folder of <target> file must exist: ' + parentTargetPath);
            return false;
        }
        try {
            Fs.accessSync(parentTargetPath, Fs.constants.W_OK);
        } catch (e) {
            errorCallback('parent folder of <target> file unwriteable: ' + targetPath);
            return false;
        }
    }

    // <target> path was validated. Export it as a side-effects artifact, for the outer world to use.
    exports.targetPath = targetPath;

    // PROOF THE OPTIONS ARGUMENT (THIS ARGUMENT IS OPTIONAL)
    // ------------------------------------------------------
    const optionsArg = args[OPTIONS_ARG_INDEX];
    if (optionsArg) {

        // If the <options file> argument was given, it must be the path to an existing and readable file in JSON format.
        const optionsPath = ensureAbsUri(optionsArg, errorCallback, 'Invalid <options file> URI: ');
        if (!optionsPath) {
            return false;
        }
        if (!Fs.existsSync(optionsPath)) {
            errorCallback('<options file> given but not found on disk: ' + optionsPath);
            return false;
        }
        try {
            Fs.accessSync(optionsPath, Fs.constants.R_OK);
        } catch (e) {
            errorCallback('<options file> path unreadable: ' + optionsPath);
            return false;
        }
        const optionsFileContent = Fs.readFileSync(optionsPath, 'utf8').trim();
        if (!optionsFileContent) {
            errorCallback('<options file> has no content: ' + optionsPath);
            return false;
        }
        let optionsData = null;
        try {
            optionsData = JSON.parse(stripJsonComments (optionsFileContent));
        } catch (optionsParseError) {
            errorCallback('<options file> is not valid JSON. Path: ' + optionsPath + '\nError: ' + optionsParseError);
        }
        if (!optionsData) {
            return false;
        }

        // Options were successfully validated and read. Export them as side-effects artifact for the outer world to use.
        exports.optionsData = optionsData;
    }


    return true;
}

