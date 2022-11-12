/*
Utility to log data in a structured way that will be reflected in Google Cloud
Platform logs.

Basically, lets you specify a severity level so we can do things like filtering
and alerting in GCP.

https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#LogSeverity
*/

export enum LogSeverity {
  INFO = 'INFO',       // Routine information, such as ongoing status or performance
  WARNING = 'WARNING', // Warning events, things that might cause problems
  ERROR = 'ERROR',     // Error events, things that are likely to cause problems
  ALERT = 'ALERT'      // A person must take an action immediately; may cause someone to be alerted
}

export default function googleCloudLog(severity: LogSeverity, message: string) {
  console.log(JSON.stringify({ severity, message }));
}
