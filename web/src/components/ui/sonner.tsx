'use client';

import { Toaster as Sonner } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

export function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast:
            'bg-dark-900 border border-dark-700 text-slate-100 shadow-2xl rounded-xl font-sans',
          description: 'text-slate-400 text-xs',
          actionButton: 'bg-honey-500 text-dark-950 font-bold',
          cancelButton: 'bg-dark-800 text-slate-300',
          closeButton: 'bg-dark-850 border border-dark-700 text-slate-400 hover:text-white',
        },
      }}
      {...props}
    />
  );
}

export { toast } from 'sonner';
