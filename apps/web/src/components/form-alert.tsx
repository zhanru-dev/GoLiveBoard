import { Alert, AlertDescription } from "@/components/ui/alert";

/** A message about the whole form, announced as soon as it appears. */
export function FormAlert({ message }: Readonly<{ message: string }>) {
  if (message === "") {
    return null;
  }
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
