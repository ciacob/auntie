'use strict';
(function () {

    // Import classes
    const Path = require('path');
    const Fs = require('fs');
    const CommonMark = require('commonmark');
    const MetaTextEngine = require('./modules/MetaTextEngine');
    const HtmlTemplateProcessor = require('./modules/HtmlTemplateProcessor');

    // Import stand-alone functions
    const {validateArgs} = require('./modules/args-validator');
    const {getFileName, ensureAbsUri} = require('./modules/path-utils');
    const sanitize = require('sanitize-filename');
    const {visitFilesInFolder, getDocumentHeader, ensureParentDirs} = require('./modules/file-utils');
    const wrapText = require("wrap-text");

    // Import constants
    const {
        HTML,
        PDF,
        DEFAULT_OUTPUT_EXTENSION,
        DEFAULT_SRC_FILE_TYPES,
        LOG_FILE_NAME,
        NO_COMPILE_TAG,
        DIR,
        ROOT,
        DEFAULT_FILE_CONTENT_PLACEHOLDER,
        DEFAULT_HTML_TEMPLATE
    } = require('./modules/constants');

    // Define own constants
    const OUTPUT_NUM_COLUMNS = 80;
    const PROGRAM_SHORT_NAME = 'AUNTIE';
    const PROGRAM_NAME = PROGRAM_SHORT_NAME + ' - AUtomatic documeNtaTIon gEnerator';
    const PROGRAM_VERSION = '1.0';
    const PROGRAM_AUTHOR = 'Claudius Tiberiu Iacob <claudius.iacob@gmail.com>';
    const PROGRAM_BANNER = wrapText([
        PROGRAM_NAME, PROGRAM_VERSION, 'by', PROGRAM_AUTHOR
    ].join(' '), OUTPUT_NUM_COLUMNS);
    const PROGRAM_USAGE = '> ' + PROGRAM_SHORT_NAME.toLowerCase() + ' <source> <target> [<options file>]';
    const HELP = [
        '\nThis application is a simple static website generator, best suited for producing technical documentation. You provide content as *.txt files and presentation via a custom HTML template. The text files need to be authored using the CommonMark syntax (a standardized version of Markdown, see "https://commonmark.org/"). Upon export, the program converts MarkDown to HTML and builds a navigation tree out of the original files\' location and numbering scheme (e.g., "1.1. My File.txt" is a child of "1. My Other File.txt"; numbering can also be applied to first header in each file). The final result is a fully navigable and standalone HTML compilation that you can upload to your web server.',
        '\nUsage:',
        PROGRAM_USAGE,
        '\nWhere:',
        '- <source>: Path to a local file or folder to supply the text for converting. For the path, use a working directory relative path, or an absolute file path. By default, all *.txt files found are converted and included in the resulting compilation, but this behavior can be changed using the <options> file (see the "sourceFileTypes" setting). As for marking a file for exclusion, you can type "$$nocompile" (without quotes) as the first thing in the respective file;',
        '\n- <target>: Path to a local file or folder to deposit the formatted document(s) in. The two paths cannot be identical; moreover, if the <source> is a folder, the <target> must be a folder as well. Other than that, the same path rules apply as for <source>;',
        '\n- <options file>: Optional. Path to a local file in JSON format to load additional configuration from. Same path rules apply as for <source> as well. See file: "samples/sample-options.json" for more details (the file has its own documentation, because ' + PROGRAM_SHORT_NAME + ' happily accepts C-style comments in the <options file>. See also file: "samples/sample-template.html", which you can use as a starting point for your own HTML templates.'
    ].map(section => wrapText(section, OUTPUT_NUM_COLUMNS)).join('\n');

    // Define own global variables
    let mtEngine = null;
    let htmlTemplatePath = null;
    let htmlTemplate = null;


    // =======
    // PROGRAM
    // =======

    /**
     * @private
     * Prints program usage along with a custom error.
     */
    function _printUsage(reason) {
        console.error('Error: %s.\nUsage: ' + PROGRAM_USAGE, reason);
    }

    /**
     * Compiles the full path to a target file, based on a source file, a target folder and a file extension.
     *
     * @param   srcFilePath {string}
     *          The source file based on which the target file name is inferred.
     *
     * @param   targetFolder {string}
     *          The home directory of the expected target file.
     *
     * @param   newExtension {string|null}
     *          A new extension to use for the target file. If not provided, the existing extension is preserved.
     *
     * @param   srcHomeDir {string|null}
     *          Optional, default `null`. A folder to produce a sub-path relative to. Useful if the produced target file
     *          path is supposed to live under nested folders. For example, let's say `srcFilePath` is:
     *          "C:\my-docs\topic-1\my-doc.txt", `targetFolder` is "C:\export" and `newExtension` is "html".
     *          If `srcHomeDir` is set to "C:\my-docs", then the produced target file path will be
     *          "C:\export\topic-1\my-doc.html". By contrast, if `srcHomeDir` is `null` or not set, the produced target
     *          file path will be "C:\export\my-doc.txt".
     *
     * @returns {string}
     * @private
     */
    function _inferTargetFilePath(srcFilePath, targetFolder, newExtension, srcHomeDir = null) {
        let targetFile = getFileName(srcFilePath, !!newExtension) + (newExtension ? '.' + newExtension : '');
        if (srcHomeDir) {
            const LEFT_SEP = /^[\\\/]+/;
            const RIGHT_SEP = /[\\\/]+$/;
            const relativePath = Path.relative(srcHomeDir, Path.dirname(srcFilePath))
                .trim()
                .replace(LEFT_SEP, '')
                .replace(RIGHT_SEP, '');
            const segments = [
                targetFile.trim()
                    .replace(LEFT_SEP, '')
                    .replace(RIGHT_SEP, '')
            ];
            if (relativePath) {
                segments.unshift(relativePath);
            }
            targetFile = segments.join(Path.sep);
        }
        return Path.resolve(targetFolder, targetFile)
    }

    /**
     * @private
     * Reads given `srcFilePath`, converts it into the target format (based on given `optionsData`) and saves it to
     * given `targetFilePath`.
     *
     * @param   srcFilePath {string}
     *          The path to read the source file from.
     *
     * @param   targetFilePath {string}
     *          The path to store the converted file to.
     *
     * @param   optionsData {object}
     *          A configuration Object that alters various functionality in the application.
     *
     * @return  {boolean}
     *          Returns `true` if reading, converting and saving the file succeeded.
     *
     */
    function _processFile(srcFilePath, targetFilePath, optionsData) {

        // Find out whether this is part of a larger, batch operation. We will not report
        // individual progress for batch operations, as this will needlessly clutter the output
        // (for batch operations, the user can enable the batch log generation from the options
        // file anyway).
        const {
            srcIsDirectory,
            targetIsDirectory
        } = require('./modules/args-validator');
        const isBatchOperation = (srcIsDirectory && targetIsDirectory);

        // Read the file.
        if (!isBatchOperation) {
            console.log('processing file "' + srcFilePath + '"...');
        }
        let fileContent = Fs.readFileSync(srcFilePath, 'utf8').trim();

        // Make a note of empty files.
        if (!fileContent) {
            if (!isBatchOperation) {
                console.log('Notice: no content in file: ' + srcFilePath);
            }
            fileContent = DEFAULT_FILE_CONTENT_PLACEHOLDER;
            if (optionsData && optionsData.fileContentPlaceholder) {
                fileContent = optionsData.fileContentPlaceholder;
            }
        }

        // Do not include files that are marked for exclusion via the $$nocompile tag.
        if (fileContent.indexOf(NO_COMPILE_TAG) == 0) {
            if (!isBatchOperation) {
                console.log('Notice: file is marked for exclusion: ' + srcFilePath);
            }
            return false;
        }

        // Resolve any includes the current file might carry.
        try {
            fileContent = mtEngine.resolveIncludes(srcFilePath, fileContent);
        } catch (e) {
            console.log('Error: bad include(s) in file ' + srcFilePath + '. Details: ' + e);
            return false;
        }

        // Resolve MTF syntax to CommonMark syntax.
        fileContent = mtEngine.resolveMTF(fileContent);

        // Parse it as 'CommonMark' syntax and convert it to target format.
        const reader = new CommonMark.Parser({smart: true})
        let writer = null;
        let postProcessor = null;
        let outputType = DEFAULT_OUTPUT_EXTENSION;
        if (optionsData && optionsData.outputType) {
            outputType = optionsData.outputType;
        }
        switch (outputType) {
            case HTML:
                if (!isBatchOperation) {
                    console.log('converting file to HTML...');
                }
                writer = new CommonMark.HtmlRenderer({softbreak: "<br />"});
                postProcessor = new HtmlTemplateProcessor(mtEngine);
                break;
            case PDF:
                writer = new CommonMark.XmlRenderer();
                // postProcessor = new PdfProcessor();
                break;
        }
        if (writer) {
            const syntaxTree = reader.parse(fileContent);
            fileContent = writer.render(syntaxTree);
            if (postProcessor) {
                fileContent = postProcessor.process(srcFilePath, syntaxTree, fileContent, htmlTemplate, optionsData);
            }
            if (!isBatchOperation) {
                console.log('conversion done.');
            }
        }

        // Save the file.
        ensureParentDirs(targetFilePath);
        Fs.writeFileSync(targetFilePath, fileContent);
        if (!isBatchOperation) {
            console.log('file saved as "' + targetFilePath + '"');
        }
        return true;
    }

    /**
     * @private
     * Handles all preliminary I/O and batch logic,e.g., resolves source and target (final) file names, filters and visits
     * source files in succession, etc. Does not actually parse, generate or store any file (except for the batch log)
     * but delegates all actual work to `_processFile()`, which is going to take care of each source file individually.
     *
     * @returns {boolean}
     *          Returns `true` if,(overall, the process is to be deemed a success; returns `false` otherwise.
     */
    function _process() {

        // These side-effect artifacts only become available AFTER validating the arguments.
        const {
            srcPath,
            targetPath,
            optionsData,
            srcIsDirectory,
            targetIsDirectory
        } = require('./modules/args-validator');
        mtEngine = new MetaTextEngine(srcPath, targetPath, optionsData);

        // If we are exporting in HTML format, we are going to need an HTML template, either the built-in one, or a
        // custom one, provided by the user via the options files' "templateFile" field. If the later is the case,
        // we need to make sure that the user-supplied template exists and is not empty.
        let outputType = DEFAULT_OUTPUT_EXTENSION;
        if (optionsData && optionsData.outputType) {
            outputType = optionsData.outputType;
        }
        if (outputType == HTML) {
            if (!htmlTemplate) {
                htmlTemplate = DEFAULT_HTML_TEMPLATE;
            }
            if (optionsData && optionsData.htmlSettings && optionsData.htmlSettings.templateFile) {
                htmlTemplatePath = ensureAbsUri(optionsData.htmlSettings.templateFile, _printUsage);
            }
            if (htmlTemplatePath) {
                if (!Fs.existsSync(htmlTemplatePath)) {
                    _printUsage('custom HTML template not found: ' + htmlTemplatePath);
                    return false;
                }
                htmlTemplate = Fs.readFileSync(htmlTemplatePath, 'utf8').trim();
            }
            if (!htmlTemplate) {
                console.log('Error: custom HTML template is empty: ' + htmlTemplatePath + '.');
                return false;
            }
        }

        // CASES:
        // 1. <source> is a file and <target> is a (non-existing) file: parse <source> and store it as <target>.
        if (!srcIsDirectory && !targetIsDirectory) {
            return _processFile(srcPath, targetPath, optionsData);
        }

        // 2. <source> is a file and <target> is a folder: parse <source> and store it inside <target> with same name
        //    and changed extension.
        let targetFileExtension = DEFAULT_OUTPUT_EXTENSION;
        if (optionsData && optionsData.outputType) {
            targetFileExtension = optionsData.outputType;
        }
        if (!srcIsDirectory && targetIsDirectory) {
            const resolvedTargetPath = _inferTargetFilePath(srcPath, targetPath, targetFileExtension);
            return _processFile(srcPath, resolvedTargetPath, optionsData);
        }

        // 3. <source> is a folder (and target is also a folder, because the arguments validator will not accept other
        //    variant): iterate through <source> files having applicable types, parse each one, and respectively store
        //    them inside <target> with same name and changed extension.
        if (srcIsDirectory && targetIsDirectory) {

            // Setup reports.
            const batchLog = {'operations': [], 'summary': ''};
            const $ = {numSuccess: 0, numSkipped: 0, numTotal: 0};

            // Define file types to include
            let fileTypesToParse = DEFAULT_SRC_FILE_TYPES;
            if (optionsData && optionsData.sourceFileTypes && optionsData.sourceFileTypes.length) {
                fileTypesToParse = optionsData.sourceFileTypes;
            }

            // Do a preflight to gather intel about all documents before actually processing them. This enables
            // generating various dynamic content, such as a navigation tree.
            const fullFileSet = fileTypesToParse.concat();
            fullFileSet.push(DIR, ROOT);
            const skippedFilePaths = visitFilesInFolder(srcPath, fullFileSet,
                function (currSrcPath, currName, currExtension, createdOn, modifiedOn) {
                    if (currSrcPath == htmlTemplatePath) {
                        return;
                    }
                    switch (currExtension) {
                        case ROOT:
                            mtEngine.addRootToIndex(currSrcPath, currName, createdOn, modifiedOn);
                            break;
                        case DIR:
                            mtEngine.addDirectoryToIndex(currSrcPath, currName, createdOn, modifiedOn);
                            break;
                        default:
                            const docHeader = getDocumentHeader(currSrcPath, [NO_COMPILE_TAG]);
                            mtEngine.addFileToIndex(currSrcPath, currName, currExtension, createdOn, modifiedOn, docHeader);
                            break;
                    }
                });

            // When building the index we need to account for any skipped files and  explicitly exclude their parent
            // folders, or else these will show in the generated navigation (because we allow for empty folders to be
            // used as separators).
            mtEngine.buildIndex(skippedFilePaths);

            // If requested (via the options file), we will copy all unprocessable files (assumed to be assets) from the
            // <source> to the <target> directory.
            if (optionsData && optionsData.htmlSettings && optionsData.htmlSettings.passThroughAssets &&
                skippedFilePaths && skippedFilePaths.length) {
                skippedFilePaths.forEach(function (assetFilePath) {
                    var targetAssetPath = _inferTargetFilePath(assetFilePath, targetPath, null, srcPath);
                    ensureParentDirs(targetAssetPath);
                    Fs.copyFileSync(assetFilePath, targetAssetPath);
                });
            }

            // Actually iterate through all the files in the source path and process each one of them in turn.
            visitFilesInFolder(srcPath, fileTypesToParse,
                function (currSrcPath) {
                    if (currSrcPath == htmlTemplatePath) {
                        return;
                    }
                    let currTargetPath = _inferTargetFilePath(currSrcPath, targetPath, targetFileExtension, srcPath);
                    let currOperationResult = _processFile(currSrcPath, currTargetPath, optionsData);
                    batchLog.operations.push({
                        'source file': currSrcPath,
                        'destination file': currTargetPath,
                        'file was included': currOperationResult
                    });
                    if (currOperationResult) {
                        $.numSuccess++;
                    } else {
                        $.numSkipped--;
                    }
                    $.numTotal++;
                });

            // Produce the report and batch log.
            const timestamp = (new Date()).toUTCString();
            const summary = ('Finished batch processing ' + $.numTotal + ' file(s) on ' + timestamp +
                '. Successfully converted: ' + $.numSuccess + ', skipped: ' + $.numSkipped + '.');
            batchLog.summary = summary;
            console.log(summary);
            if (optionsData && optionsData.outputBatchLog) {
                const logFileName = sanitize(LOG_FILE_NAME.replace('%s', timestamp), {replacement: '-'});
                const logFilePath = Path.resolve(targetPath, logFileName);
                Fs.writeFileSync(logFilePath, JSON.stringify(batchLog, null, '\t'));
            }
            return ($.numSuccess > 0);
        }
        return false;
    }


    // MAIN LOGIC
    // ----------
    // Print banner.
    console.log('\n\n' + PROGRAM_BANNER);

    // Print help if requested.
    const args = process.argv;
    if (args.length == 3 && args[2] == '-h') {
        console.log(HELP);
        return;
    }

    // Execute.
    let success = validateArgs(args, _printUsage) && _process();

    // Print footer.
    console.log(success ? 'Process completed normally.' : 'Process failed. For help, run: ' + PROGRAM_SHORT_NAME.toLowerCase() + ' -h');
})();