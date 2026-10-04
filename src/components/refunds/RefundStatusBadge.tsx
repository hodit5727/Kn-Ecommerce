import React from 'react';
import { RefundStatus } from '../../types/refund';
import { Badge } from '../common/Badge';

export const RefundStatusBadge: React.FC<{ status: RefundStatus }> = ({ status }) => {
  switch (status) {
    case 'REQUESTED':
      return <Badge variant="stone" dot>Requested</Badge>;
    case 'UNDER_REVIEW':
      return <Badge variant="amber" dot>Under Review</Badge>;
    case 'APPROVED':
      return <Badge variant="emerald" dot>Approved</Badge>;
    case 'PROCESSING':
      return <Badge variant="cream" dot>Processing Payout</Badge>;
    case 'COMPLETED':
      return <Badge variant="burgundy" dot>Completed</Badge>;
    case 'REJECTED':
      return <Badge variant="rosered" dot>Claim Declined</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
};
