'use strict';
const Path = require('path');
const vsprintf = require('sprintf-js').vsprintf;
const prettify = require('html-prettify');
const {changeFileExtension, getFileName} = require('./path-utils');

// Import constants
const {
    DEFAULT_NAVIGATION_NUMBERING_HIDING,

    DIR,
    ROOT,

    NAV_ROOT_TEMPLATE,
    NAV_GROUP_TEMPLATE,
    NAV_ITEM_TEMPLATE,
    NAV_ITEM_CONTENT_TEMPLATE,
    LINK_TEMPLATE,

    NUMBERING_PATTERN
} = require('./constants');

/**
 * Class that handles MTF specific operations, such as resolving inclusions, converting MetaText syntax into
 * CommonMarks syntax, generating a Table of Contents, etc.
 *
 * @param   srcPath {String}
 *          The parsed value of the <source> argument.
 *
 * @param   targetPath {String}
 *          The parsed value of the <target> argument.
 *
 * @param   optionsData {object}
 *          The configuration the program has been started with, if applicable.
 *
 * @constructor
 */
module.exports = function MetaTextEngine(srcPath, targetPath, optionsData) {

    /**
     * Flag we raise when te buildIndex() method has been called, to prevent further additions to the index.
     * @type {boolean}
     * @private
     */
    let _isIndexSealed = false;

    /**
     * Storage for an abstract hierarchical representation that can be used to build a Table of Contents with links,
     * both on HTML and PDF (and any other output format that we might support in the future).
     * @type {Object[]}
     * @private
     */
    const _abstractNavigationTree = [];

    /**
     * Unidimensional registry for all files and folders that are to be compiled.
     * @private
     * @type {object[]}
     */
    const _flatCompilationsList = [];

    /**
     * Convenient storage for the folder structure based groups found in the early processing stage of the compilation list.
     * @type {array[]}
     */
    const _rawGroups = [];

    /**
     * List of (empty) folders to be marked for exclusion, so that they do not show in the generated navigation
     * (as separators).
     * @type {string[]}
     * @private
     */
    const _foldersToExclude = [];

    /**
     * Whether we should strip off existing numbering from generated HTML navigation tree items.
     * @type {boolean}
     * @private
     */
    let _mustHideNavNumbering = DEFAULT_NAVIGATION_NUMBERING_HIDING;
    if (optionsData && optionsData.htmlSettings) {
        _mustHideNavNumbering = !!optionsData.htmlSettings.hideNavigationNumbering;
    }

    /**
     * Builds a relative URL that would cause the browser to navigate between two given locations
     *
     * @param   fromPath
     *          The path of the (HTML) document that will include the link with the built URL.
     *
     * @param   toPath
     *          The path of the (HTML) document were the built URL needs to go.
     *
     * @param   fileType {string}
     *          Optional, default 'html'. The file type to append to the resulting relative URL.
     *
     * @param   assumeFolders {boolean}
     *          Optional, default `false`. If true, the `fromPath` and `toPath` will be treated as folder
     *          paths instead of file paths.
     *
     * @return  {string} The relative URL built.
     * @private
     */
    const _makeRelUrl = function (fromPath, toPath, fileType = 'html', assumeFolders = false) {
        const LEFT_SEP = /^[\\\/]+/;
        const RIGHT_SEP = /[\\\/]+$/;
        const BACKSLASH = /\\+/g;
        const targetFileName = changeFileExtension (getFileName(toPath), fileType);
        const fromDirPath = Path.dirname(fromPath);
        const toDirPath = Path.dirname(toPath);
        const relPath = Path.relative(fromDirPath, toDirPath).trim()
            .replace(LEFT_SEP, '')
            .replace(RIGHT_SEP, '');
        const segments = assumeFolders? [] : [
            targetFileName.trim()
                .replace(LEFT_SEP, '')
                .replace(RIGHT_SEP, '')
        ];
        if (relPath) {
            segments.unshift(relPath);
        }
        return segments.join(Path.sep).replace (BACKSLASH, '/');
    }

    /**
     * Inner class that abstracts away creation and rendition of HTML mark-up blocks.
     *
     * @param   template {string}
     *          String to be used as starting point when rendering this HtmlElementProxy instance.
     *
     * @constructor
     * @private
     */
    const HtmlElementProxy = function (template) {

        /**
         * Storage for the template of this HtmlElementProxy instance.
         * @type {string}
         * @private
         */
        const _template = template;

        /**
         * Storage for any child HtmlElementProxy instances the current instance might have.
         * @type {HtmlElementProxy[]}
         * @private
         */
        const _children = [];

        /**
         * Storage for the data the template is to be populated with upon rendering.
         * This does NOT include children elements.
         * @type {array}
         * @private
         */
        let _data = [];

        /**
         * Associates data with this HtmlElementProxy instance. It will be used to populate
         * the instance's template with.
         * @param data
         */
        this.setData = function (data) {
            _data = data;
        }

        /**
         * Adds one child HtmlElementProxy instance to current instance. Children will be
         * recursively stringified and used to populate the instance's template.
         * @param child {HtmlElementProxy}
         */
        this.addChild = function (child) {
            _children.push(child);
        }

        /**
         * Stringifies the children, if any, appends the result to the data already stored,
         * and uses it to populate the HtmlElementProxy instance's template. Since all children
         * are HtmlElementProxy instances themselves, this triggers a recursive rendering process,
         * resulting in the root HtmlElementProxy instance producing the full HTML mark-up for all
         * children and grandchildren added.
         *
         * @return {string}
         */
        this.render = function () {
            const stringifiedChildren = '\n' + _children.map(child => child.render()).join('\n') + '\n';
            const templateArgs = _data.concat(stringifiedChildren);
            return vsprintf(_template, templateArgs);
        }
    };

    /**
     * Inner class that creates or recycles HtmlElementProxy instances, as needed, based on a
     * internal registry.
     *
     * @constructor
     */
    const HtmlElementProxyFactory = function () {

        /**
         * Storage to keep track of created instances.
         * @type {object}
         * @private
         */
        const registry = {};

        /**
         * Returns a HtmlElementProxy instance, either pristine or recycled.
         *
         * @param   id {string}
         *          Globally unique ID that identifies an  HtmlElementProxy instance.
         *
         * @param   template {string}
         *          The template to use when building an HtmlElementProxy instance.
         *
         * @param   data {array}
         *          Data to populate built HtmlElementProxy instances with.
         */
        this.getHtmlElementProxy = function (id, template = '', data = null) {
            if (!(id in registry)) {
                const htmlEl = new HtmlElementProxy(template);
                if (data) {
                    htmlEl.setData(data);
                }
                registry[id] = htmlEl;
            }
            return registry[id];
        }
    };

    /**
     * Puts given `label` in Title Case, also converting dash or underscore separated words into space
     * separated words and normalizing whitespace use. Some heuristics is used to (try to) account for
     * edge cases. Optionally removes leading numbering if present.
     *
     * NOTE: if a header uses both dashes/underscores and whitespaces as separators, its dashes/underscores are not
     * stripped off.
     *
     * @param   label {string}
     *          The label to be tidied up. `Null` is tolerated and passed trough unchanged.
     *
     * @param   removeNumbering {boolean}
     *          Optional, default true. Strips off numbering (e.g., "1.1.2") from the beginning
     *          of `label`.
     *
     * @return  {string}
     *          The tidied up label, provided it contained actual text; the original label otherwise.
     */
    const tidyUpLabel = function (label, removeNumbering = true) {
        let changedLabel = (label || '').trim();
        if (!changedLabel) {
            return label;
        }

        // Local constants
        const SPACE_PATTERN = /\s+/g;
        const DASH_PATTERN = /[\-]+/g;
        const UNDERSCORE_PATTERN = /[\_]+/g;
        const ALPHA_NUMERIC_PATTERN = /\w\S*/g;
        const DASH_AND_UNDERSCORE_PATTERN = /[\_\-]+/g;
        const KNOWN_LOWER_CASE = ['a', 'an', 'and', 'as', 'at', 'but', 'by', 'en', 'for', 'if',
            'in', 'of', 'on', 'or', 'the', 'to', 'v', 'v.', 'via', 'vs', 'vs.'];
        const KNOWN_UPPER_CASE = ['todo', 'imo', 'imho', 'afaik', 'fyi', 'at&t', 'q&a', 'ui', 'ux', 'rsvp', 'eta', 'faq',
            'atm', 'rip', 'p.s.', 'diy', 'id', 'iq', 'gmo', 'pc', 'pr', 'sos', 'ad', 'bc', 'hr'];
        if (optionsData && optionsData.customAcronyms) {
            optionsData.customAcronyms.forEach(
                customAcronym => KNOWN_UPPER_CASE.push(customAcronym.toLowerCase()));
        }

        // Remove trailing navigation. if requested
        if (removeNumbering) {
            changedLabel = changedLabel.replace(NUMBERING_PATTERN, '').trim();
        }

        // Replace the char used for separating words if the label seems to be using
        // dashes or underscores as word separators.
        const numSpaceUses = (changedLabel.match(SPACE_PATTERN) || []).length;
        const numDashUses = (changedLabel.match(DASH_PATTERN) || []).length;
        const numUnderScoreUses = (changedLabel.match(UNDERSCORE_PATTERN) || []).length;
        const labelUsesDashesOrUnderscores = (numDashUses > 0 || numUnderScoreUses > 0);
        const whiteSpaceIsScarce = numSpaceUses < (Math.max(numDashUses, numUnderScoreUses));
        const mustEnforceWhiteSpace = (labelUsesDashesOrUnderscores && whiteSpaceIsScarce);
        if (mustEnforceWhiteSpace) {
            const replaceSrc = (numDashUses > numUnderScoreUses) ? DASH_PATTERN :
                (numUnderScoreUses > numDashUses) ? UNDERSCORE_PATTERN :
                    DASH_AND_UNDERSCORE_PATTERN;
            changedLabel = changedLabel.replace(replaceSrc, ' ');
        }
        changedLabel = changedLabel.replace(SPACE_PATTERN, ' ').trim();

        // Put in title case if the label is not using mixed case. Make sure known acronyms
        // remain upper-cased.
        const isAllCaps = (changedLabel.toUpperCase() == changedLabel);
        const isAllLower = (changedLabel.toLowerCase() == changedLabel);
        const mustChangeCase = (isAllCaps || isAllLower);
        if (mustChangeCase) {
            changedLabel = changedLabel.toLowerCase();
            let tokens = changedLabel.split(' ');
            tokens = tokens.map(function (token, i, arr) {
                return (KNOWN_LOWER_CASE.includes(token) &&
                    (i != 0) && (i != arr.length - 1)) ? token.toLowerCase() :
                    (KNOWN_UPPER_CASE.includes(token)) ? token.toUpperCase() :
                        token.replace(ALPHA_NUMERIC_PATTERN, function (txt) {
                            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
                        });
            });
            changedLabel = tokens.join(' ');
        }

        // Finally, resolve '--' and similar to the "en dash" character.
        changedLabel = changedLabel.replace(DASH_PATTERN, '–');
        return changedLabel;
    };

    /**
     * Extracts and parses any numbering system the given `text` might start with, such as "1.1.2 My Section" or
     * "00-02-01--my-file.html", or the like.
     *
     * @param   text {string}
     *          The text to extract the numbering from. Only one line of text is supported.
     *
     * @return  {number[]}
     *          Array with numbers, respectively representing the numeric values extracted, e.g. [1,1,2] or
     *          [0,2,1]. Returns `null` if the text does not seem to carry any numbering.
     * @private
     */
    const _extractNumbering = function (text) {
        text = (text || '').trim();
        if (!text) {
            return null;
        }
        const rawMatch = text.match(NUMBERING_PATTERN);
        if (!rawMatch) {
            return null;
        }
        const matchedString = rawMatch[0];
        if (!matchedString) {
            return null;
        }
        const rawSegments = matchedString.split(/[\W_]+/).filter(token => token != '');
        if (!rawSegments.length) {
            return null;
        }
        return rawSegments.map(token => {
            while (token.charAt(0) == '0' && token.length > 1) {
                token = token.slice(1);
            }
            return parseInt(token);
        });
    };


    /**
     * Compares the "numberings" of two given compilation units. A numbering is an Array of integers, e.g [1,5,47] or
     * [1,0,16,0]. This function is meant to be used as an argument to the Array.sort() method.
     *
     * @param   unitA {object}
     *          First unit to compare by its numbering.
     *
     * @param   unitB {object}
     *          Second unit to compare by its numbering.
     *
     * @return  {number}
     *          Positive integer if the `unitA` numbering compares "greater than" the `unitB` numbering;
     *          negative integer if `unitA` compares "less than" `unitB`; and 0 if they compare "equal".
     * @private
     */
    const _multiPartComparison = function (unitA, unitB) {
        const aSegments = unitA.numbering;
        const bSegments = unitB.numbering;

        // Prepare A
        if (aSegments == null) {
            return 0;
        }
        const numASegments = aSegments.length;
        if (numASegments == 0) {
            return 0;
        }

        // Prepare B
        if (bSegments == null) {
            return 0;
        }
        const numBSegments = bSegments.length;
        if (numBSegments == 0) {
            return 0;
        }

        // Compare
        const maxLength = Math.max(numASegments, numBSegments);
        let i = 0;
        let aSegment;
        let bSegment;
        let delta;
        for (i; i < maxLength; i++) {
            aSegment = aSegments[i] || 0;
            bSegment = bSegments[i] || 0;
            delta = (aSegment - bSegment);
            if (delta != 0) {
                return delta;
            }
        }

        // Fallback to longest operand if nothing else helps (or else, the above code would see [1,0] and
        // [1,0,0] as "equal").
        return (numASegments - numBSegments);
    };

    /**
     * Iterates through all the nodes, sub-nodes and leaves of given tree `node`. The given `callback`
     * is called with two Object arguments, "current node"  and "parent node".
     *
     * @param   node {object}
     *          Array of Objects, optionally having a `children` property of type object[] (a nested
     *          Array of Objects).
     *
     * @param   callback {function}
     *          Function having the signature:
     *          onNodeVisited (node, parentNode, absoluteIndex);
     *          If this function returns `false`, then iterating immediately stops.
     * @private
     */
    const _walkTree = function (node, callback, parent) {
        _walkTree.mustExitNow = false;
        let currNode;
        let iterable = node[Symbol.iterator]();
        while ((currNode = iterable.next().value)) {
            if (_walkTree.mustExitNow) {
                break;
            }
            _walkTree.mustExitNow = callback(currNode, parent);
            if (currNode.children) {
                _walkTree(currNode.children, callback, currNode);
            }
        }
    };

    /**
     * Actually creates the replacement for the "$$navigation" template placeholder. The resulting links' URLs are
     * adapted to the actual location of the document pointed to by `docId`.
     *
     * @param   docId {string}
     *          A string uniquely identifying a document in the compilation, usually the fully qualified path to its
     *          originating file.
     */
    const _buildHtmlNavigation = function (docId) {
        const htmlFactory = new HtmlElementProxyFactory();
        const $ = {rootHtmlEl: null};
        _walkTree(_abstractNavigationTree,
            (unit, parentUnit) => {
                if (unit.mustExclude) {
                    return;
                }

                const isRoot = (parentUnit == null);
                const isNode = unit.isNode;
                const id = unit.filePath;

                // The root container is not the actual parent of list items. We need to add it a child UL element
                // and use that instead.
                if (isRoot) {
                    const rootHtmlContainer = htmlFactory.getHtmlElementProxy(id + '#container', NAV_ROOT_TEMPLATE);
                    const rootNavGroup = htmlFactory.getHtmlElementProxy(id, NAV_GROUP_TEMPLATE);
                    rootHtmlContainer.addChild(rootNavGroup);
                    $.rootHtmlEl = rootHtmlContainer;
                }

                // Nodes must be containers for list items, but also list items themselves. If a node is not
                // a directory, then it also must display its own link.
                else if (isNode) {
                    const parentEl = htmlFactory.getHtmlElementProxy(parentUnit.filePath);
                    const nodeHtmlItem = htmlFactory.getHtmlElementProxy(id + '#node_item', NAV_ITEM_TEMPLATE);
                    let nodeItemContentEl;
                    if (unit.fileExtension == DIR) {
                        nodeItemContentEl = htmlFactory.getHtmlElementProxy(id + '#node_item_content',
                            NAV_ITEM_CONTENT_TEMPLATE, [unit.fileHeader || unit.fileName]);
                    } else {
                        nodeItemContentEl = htmlFactory.getHtmlElementProxy(id + '#node_item_content',
                            NAV_ITEM_CONTENT_TEMPLATE);
                        const nodeContentLinkEl = htmlFactory.getHtmlElementProxy(id + '#node_content_link',
                            LINK_TEMPLATE, [_makeRelUrl(docId, unit.filePath), unit.fileHeader]);
                        nodeItemContentEl.addChild(nodeContentLinkEl);
                    }
                    nodeHtmlItem.addChild(nodeItemContentEl);
                    parentEl.addChild(nodeHtmlItem);
                    const nodeHtmlGroup = htmlFactory.getHtmlElementProxy(id, NAV_GROUP_TEMPLATE);
                    parentEl.addChild(nodeHtmlGroup);
                }

                // Empty directories must be rendered as inert list items
                else if (unit.fileExtension == DIR) {
                    const parentEl = htmlFactory.getHtmlElementProxy(parentUnit.filePath);
                    const nodeHtmlItem = htmlFactory.getHtmlElementProxy(id + '#node_item', NAV_ITEM_TEMPLATE);
                    const nodeItemContentEl = htmlFactory.getHtmlElementProxy(id + '#node_item_content',
                        NAV_ITEM_CONTENT_TEMPLATE, [unit.fileHeader]);
                    nodeHtmlItem.addChild(nodeItemContentEl);
                    parentEl.addChild(nodeHtmlItem);
                }

                // Leaves need links added.
                else {
                    const parentEl = htmlFactory.getHtmlElementProxy(parentUnit.filePath);
                    const leafHtmlItem = htmlFactory.getHtmlElementProxy(id, NAV_ITEM_TEMPLATE);
                    const leafItemContentEl = htmlFactory.getHtmlElementProxy(id + '#leaf_item_content',
                        NAV_ITEM_CONTENT_TEMPLATE);
                    const leafContentLinkEl = htmlFactory.getHtmlElementProxy(id + '#leaf_content_link',
                        LINK_TEMPLATE, [_makeRelUrl(docId, unit.filePath), unit.fileHeader]);
                    leafItemContentEl.addChild(leafContentLinkEl);
                    leafHtmlItem.addChild(leafItemContentEl);
                    parentEl.addChild(leafHtmlItem);
                }
            });

        // For individual runs (i.e., the <source> program argument is a file, not a folder) it makes no sense to build
        // a navigation tree. In this situation we return an empty string.
        if ($.rootHtmlEl) {
            const navigationHtmlMarkup = $.rootHtmlEl.render();
            return (prettify(navigationHtmlMarkup));
        }
        return '';
    };

    /**
     * TODO: document
     * @param filePath {string}
     * @param fileContent {string}
     * @return {string}
     * @throws {error}
     *          If a path in the inclusions chain is broken or circular inclusion is detected (A < B < C < A).
     */
    this.resolveIncludes = function (filePath, fileContent) {
        // TODO: implement
        return fileContent;
    };

    /**
     * TODO: document
     * @param content {string}
     * @return {string}
     */
    this.resolveMTF = function (content) {
        // TODO: implement
        return content;
    }

    /**
     * Registers information about the compilation's "root". Technically, this is the folder received as the <source>
     * argument. Its name will provide the compilation's name, its modification timestamp will provide the compilation's
     * release date, and all the paths in the generated navigation will be coerced to be relative to it.
     *
     * @param   rootPath {string}
     *          Absolute local path to the root folder.
     *
     * @param   rootName {string}
     *          Name of the root folder.
     *
     * @param   rootCtime {number}
     *          Root folder creation time in milliseconds, as reported by the OS.
     *
     * @param   rootMTime {number}
     *          Root folder modification time in milliseconds, as reported by the OS.
     */
    this.addRootToIndex = function (rootPath, rootName, rootCtime, rootMTime) {
        if (_isIndexSealed) {
            throw (new Error('MetaTextEngine:: addFileToIndex() called after buildIndex() was called. The index is sealed and cannot be updated anymore.'));
        }
        const unit = {
            'filePath': rootPath,
            'fileName': rootName,
            'fileExtension': ROOT,
            'fileCTime': rootCtime,
            'fileMTime': rootMTime,
            'fileHeader': tidyUpLabel(rootName),
            'isNode': true,
            'numberingSignature': ''
        };
        _abstractNavigationTree.splice(0, 0, unit);
        _flatCompilationsList.push(unit);
    }

    /**
     * Registers information about regular folders used in the compilation to group documents together. In generated
     * global navigation, directories will show as non-clickable tree nodes.
     *
     * @param   dirPath {string}
     *          Absolute local path to the folder.
     *
     * @param   dirName {string}
     *          Name of the folder.
     *
     * @param   dirCtime {number}
     *          Folder creation time in milliseconds, as reported by the OS.
     *
     * @param   dirMTime {number}
     *          Folder modification time in milliseconds, as reported by the OS.
     */
    this.addDirectoryToIndex = function (dirPath, dirName, dirCtime, dirMTime) {
        if (_isIndexSealed) {
            throw (new Error('MetaTextEngine:: addFileToIndex() called after buildIndex() was called. The index is sealed and cannot be updated anymore.'));
        }
        const unit = {
            'filePath': dirPath,
            'fileName': dirName,
            'fileExtension': DIR,
            'fileCTime': dirCtime,
            'fileMTime': dirMTime,
            'fileHeader': dirName,
            'numberingSignature': ''
        }
        _flatCompilationsList.push(unit);

        // For folders, their parenting is strictly related to the underlying OS file structure.
        const parent = _flatCompilationsList.filter(unit => unit.filePath == Path.dirname(dirPath))[0];
        unit.parent = parent.filePath;
        parent.isNode = true;

        // Move the folder under its parent.
        if (!parent.children) {
            const children = [];
            parent.children = children;
            _rawGroups.push(children);
        }
        parent.children.push(unit);

        // Folder numbering, provided they have such thing, will not influence their parenting, merely sibling ordering.
        const numbering = _extractNumbering(dirName);
        if (numbering) {
            unit.numbering = numbering;
            unit.numberingSignature = numbering.join('.') + '. ';
        }

        // Put header in proper case.
        const headerPrefix = (_mustHideNavNumbering ? '' : unit.numberingSignature);
        unit.fileHeader = headerPrefix + tidyUpLabel(unit.fileHeader);
    }

    /**
     * Registers information about a specific document in the compilation. This information is relational, and is
     * refined with every new document added. Once all document are added to the dataset, the class will be able to use
     * it to produce general purpose generated content, such as global and local navigation.
     *
     * @param   filePath {string}
     *          Absolute local path to the file.
     *
     * @param   fileName {string}
     *          Convenient access to file's name, minus extension.
     *
     * @param   fileExtension {string}
     *          Convenient access to file's extension.
     *
     * @param   fileCTime {number}
     *          File creation time in milliseconds, as reported by the OS.
     *
     * @param   fileMTime {number}
     *          File modification time in milliseconds, as reported by the OS.
     *
     * @param   fileHeader {string|null}
     *          Content of first line of the file, minus any tags that it might contain. Documents marked for exclusion
     *          (they have the exclusion tag in their header) return `null`, and so do empty documents.
     */
    this.addFileToIndex = function (filePath, fileName, fileExtension, fileCTime,
                                    fileMTime, fileHeader) {
        if (_isIndexSealed) {
            throw (new Error('MetaTextEngine:: addFileToIndex() called after buildIndex() was called. The index is sealed and cannot be updated anymore.'));
        }

        // Add the document to the registry
        const unit = {
            'filePath': filePath,
            'fileName': fileName,
            'fileExtension': fileExtension,
            'fileCTime': fileCTime,
            'fileMTime': fileMTime,
            'fileHeader': fileHeader,
            'numberingSignature': ''
        };
        _flatCompilationsList.push(unit);

        // Extract document numbering, if available.
        let numbering = _extractNumbering(fileName);
        if (!numbering) {
            numbering = _extractNumbering(fileHeader);
        }
        if (numbering) {
            unit.numbering = numbering;
            unit.numberingSignature = numbering.join('.') + '. ';
        }

        // Put header in proper case.
        if (!fileHeader) {
            fileHeader = changeFileExtension(unit.fileName, '');
        }
        const headerPrefix = (_mustHideNavNumbering ? '' : unit.numberingSignature);
        unit.fileHeader = headerPrefix + tidyUpLabel(fileHeader);

        // Determine the document's parent based on folders structure. We will try to refine it based on numbering upon
        // closing the index.
        let parent = _flatCompilationsList.filter(unit => unit.filePath == Path.dirname(filePath))[0];
        unit.parent = parent.filePath;
        parent.isNode = true;

        // Move the document under its parent.
        if (!parent.children) {
            const children = [];
            parent.children = children;
            _rawGroups.push(children);
        }
        parent.children.push(unit);
    }

    /**
     * Finalizes (and seals) the list of compilation units built so far by proofing and refining the hierarchical
     * relationships between all involved documents. Calling `addFileToIndex()` after `buildIndex()` has been called
     * will throw an error.
     *
     * @param   skippedFilePaths {string[]|null}
     *          Optional. An array of skipped file paths to account for. If provided, their parent folder(s) will be
     *          marked for omision, and will not be rendered in teh generated navigation tree (where empty folders are
     *          otherwise used as separators).
     */
    this.buildIndex = function (skippedFilePaths = null) {
        _isIndexSealed = true;

        // Mark for exclusion asset parent folders
        if (skippedFilePaths && skippedFilePaths.length) {
            const rootFolderPath = _flatCompilationsList[0].filePath;
            skippedFilePaths.forEach (skippedPath => {
                do {
                    skippedPath = Path.dirname(skippedPath);
                    if (skippedPath == rootFolderPath) {
                        break;
                    }
                    if (!_foldersToExclude.includes(skippedPath)) {
                        _foldersToExclude.push (skippedPath);
                    }
                } while (true);
            });
            if (_foldersToExclude.length) {
                const unitsToExclude = _flatCompilationsList.filter (unit => _foldersToExclude.includes (unit.filePath));
                unitsToExclude.forEach(unit => unit.mustExclude = true);
            }
        }

        // Order the documents in each group based on their numbering
        _rawGroups.forEach(group => group.sort(_multiPartComparison));

        // With the documents ordered, iteratively move every document as a child of its left sibling, if its
        // "numbering" has more segments than the sibling's.
        while (_rawGroups.length > 0) {
            const group = _rawGroups.shift();
            let i = 0;
            do {
                if (i > 0) {
                    const unit = group[i];
                    const prevUnit = group[i - 1];
                    if (unit.fileExtension != DIR && prevUnit.fileExtension != DIR &&
                        unit.numbering && prevUnit.numbering &&
                        unit.numbering.length > prevUnit.numbering.length) {
                        if (!prevUnit.children) {
                            const children = [];
                            prevUnit.children = children;
                            _rawGroups.push(children);
                        }
                        prevUnit.children.push(group.splice(i, 1)[0]);
                        prevUnit.isNode = true;
                        continue;
                    }
                }
                i++;
            } while (i < group.length);
        }
    }

    /**
     * Builds and returns an HTML navigation tree that is suitable for use from within the HTML file generated from
     * given `filePath` (the rationale behind that being that the URLs of the links inside the tree need to be
     * adapted to the actual target file location).
     * @param filePath
     */
    this.getHtmlNavigationFor = function (filePath) {
        return _buildHtmlNavigation (filePath);
    }

    /**
     * Returns the relative path that leads from the given `filePath` to the root directory of the HTML compilation.
     * Useful for easily pointing to assets that live in a root directory's subfolder, or as a more convenient way of
     * linking from one document to another (it is easier because the location of the source document become irrelevant,
     * only the root-relative path to the target document is needed).
     *
     * NOTE: returned path DOES NOT end with a slash ('/'). That must be added explicitly, e.g.:
     * <link rel="stylesheet" href="$$rootDir/assets/mystyle.css">
     */
    this.getRootDirPathFor = function (filePath) {

        // NOTE: for individual runs (i.e., the <source> program argument is a file, not a folder, it makes no sense to
        // compute a "root directory path". In this situation we return an empty string.
        if (!_flatCompilationsList.length) {
            return '';
        }
        const rootAbsPath = _flatCompilationsList[0].filePath;
        const homeDirAbsPath = Path.dirname (filePath);
        const rootPathPrefix  = _makeRelUrl (homeDirAbsPath, rootAbsPath, '', true);
        return (rootPathPrefix? rootPathPrefix + '/' : '');
    }

    /**
     * Returns a timestamp of the given file's last modification time, as reported by the underlying OS.
     * NOTE: when the <source> argument is not a folder, this will return an empty string.
     * @param filePath {string}
     */
    this.getTimeStampFor = function (filePath) {

        // NOTE: not available for individual runs (i.e., when the <source> program argument is a file, not a folder).
        // In this situation we return an empty string.
        if (_flatCompilationsList.length) {
            const fileInfo = _flatCompilationsList.filter (unit => unit.filePath == filePath)[0];
            if (fileInfo) {
                return (new Date(fileInfo.fileMTime)).toLocaleString('en-EN', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    timeZone: 'UTC'
                });
            }
        }
        return '';
    }

    /**
     * Returns the header of the root element in a compilation. If
     * `separator` is also provided, it is appended, preceded by
     * whitespace.
     * NOTE: when the <source> argument is not a folder, this will
     * return an empty string.
     */
    this.getCompilationHeader = function (separator) {
        if (_flatCompilationsList.length) {
            const rootAbsPath = _flatCompilationsList[0];
            return rootAbsPath.fileHeader +
                (separator? (' ' + separator) : '');
        }
        return '';
    }

    /**
     * Returns the header of the document having the given `srcFilePath`.
     * NOTE: when the <source> argument is not a folder, this will
     * return an empty string.
     * @param srcFilePath
     */
    this.getHeaderFor = function (srcFilePath) {
        if (_flatCompilationsList.length) {
            const doc = _flatCompilationsList
                .filter(unit => unit.filePath == srcFilePath)[0];
            if (doc) {
                return doc.fileHeader;
            }
        }
        return '';
    }
};