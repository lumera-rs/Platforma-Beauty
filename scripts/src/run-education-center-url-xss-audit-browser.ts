import {
  runIsolatedBrowserSuiteCommand,
  type IsolatedBrowserSuiteConfiguration,
} from "./run-isolated-browser-suite";

const configuration: IsolatedBrowserSuiteConfiguration = {
  databasePrefix: "lumera_edu_center_xss_audit_browser_",
  manifestDirectoryName: "education-center-url-xss-audit-browser-databases",
  specPath: "browser/education-center-url-xss-audit.spec.ts",
  testLabel: "Task #9 audit: education center websiteUrl javascript: URI reproduction",
  environment: {
    LUMERA_ISOLATED_EDUCATION_CENTER_URL_XSS_AUDIT_BROWSER_TEST: "1",
    LUMERA_RELEASE_BROWSER_TEST: "1",
  },
};

void runIsolatedBrowserSuiteCommand(configuration);
