import type { CustomerFlag } from './types';
import { customerFlagSvg } from './flagIcons';

/* eslint-disable @eslint-react/dom/no-dangerously-set-innerhtml, react/no-danger -- Markup contains only fixed application-owned SVG paths and colors. */
export default function CustomerFlagIcon({ flag }: { flag: CustomerFlag }) {
  return (
    <span
      className="customer-letter-icon"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: customerFlagSvg(flag) }}
    />
  );
}
/* eslint-enable @eslint-react/dom/no-dangerously-set-innerhtml, react/no-danger */
