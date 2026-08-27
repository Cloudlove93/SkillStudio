import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
};

export function MultimodalDrawer(props: Props) {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="skill-mm-drawer-overlay" />
        <Dialog.Content className="skill-mm-drawer-content">
          <header>
            <div>
              <Dialog.Title>{props.title}</Dialog.Title>
              {props.description && (
                <Dialog.Description>
                  {props.description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close aria-label="关闭">
              <X size={18} />
            </Dialog.Close>
          </header>
          <div className="skill-mm-drawer-body">{props.children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
