/* Application-wide constants */
const _ = exports;

// Parser related
_.HTML = 'html';
_.PDF = 'pdf';
_.DEFAULT_OUTPUT_EXTENSION = _.HTML;
_.DEFAULT_SRC_FILE_TYPES = ['txt'];
_.LOG_FILE_NAME = 'MTF Exporter Log - %s.log';

// HTML generation related
_.DEFAULT_NAVIGATION_NUMBERING_HIDING = false;
_.NUMBERING_PATTERN = /^[\d\W_]+/;
_.DIR = '907d1e2a-6bc2-49d5-b036-57dcea0d9cf1';
_.ROOT = '8af35ebb-6e35-49b6-988d-42787ab7110d';
_.NO_COMPILE_TAG = '$$nocompile';
_.ROOT_NAME_TAG = '$$rootName';
_.DOC_NAME_TAG = '$$docName';
_.ROOT_DIR_TAG = '$$rootDir$$';
_.NAVIGATION_TAG = '$$navigation';
_.DOCUMENT_TAG = '$$document';
_.LAST_UPDATED_TAG = '$$lastUpdated';
_.NAV_ROOT_TEMPLATE = '<div class="navigation">%s</div>';
_.NAV_GROUP_TEMPLATE = '<ul class="nav-group">%s</ul>';
_.NAV_ITEM_TEMPLATE = '<li class="nav-item">%s</li>';
_.NAV_ITEM_CONTENT_TEMPLATE = '<label class="item-content">%s</label>';
_.LINK_TEMPLATE = '<a href="%s">%s</a>';
_.NEW_TAB_LINK_TEMPLATE = '<a target="_blank" rel="noopener noreferrer" href="%s">%s</a>';
_.DEFAULT_FILE_CONTENT_PLACEHOLDER = '# Coming Soon!\nThis section is still being worked on.';
_.DEFAULT_HTML_TEMPLATE = '<!DOCTYPE html><html lang="en">' +
    '<head><title>' + _.ROOT_NAME_TAG + ' ' + _.DOC_NAME_TAG + '</title>' +
    '<meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head>' +
    '<body><div class="main-container"><div class="page-container">' +
    '<div class="nav-container"><nav>' + _.NAVIGATION_TAG + '</nav></div>' +
    '<div class="doc-container"><main>' + _.DOCUMENT_TAG + '</main><aside>' + _.LAST_UPDATED_TAG + '</aside>' +
    '</div></div></div></body></html>';
