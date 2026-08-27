import { useRegisterBusiness } from "@workspace/api-client-react";

export function NewGeneratedClientHandlerFixture() {
  const registerBusiness = useRegisterBusiness();

  return () => {
    registerBusiness.mutate({} as never, {
      onError: (error: unknown) => {
        const message = (error as { data?: { error?: string } }).data?.error;
        const responseData = error?.response?.data;
        const status = error?.response?.status;
        return { message, responseData, status };
      },
    });
  };
}