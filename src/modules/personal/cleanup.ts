import type { Db } from '@/server/db';

/**
 * Remove private placements for cards that are no longer in the subject's
 * responsibility list (tag change, soft delete, subject left the team).
 * When responsibility returns later, the card re-enters the default column.
 */
export async function syncPersonalPlacements(tx: Db, productId: string) {
  await tx`
    delete from personal_placements pp
    using personal_views pv, feedback f
    where pp.view_id = pv.id and pv.product_id = ${productId} and f.id = pp.feedback_id
      and (
        f.deleted_at is not null
        or not exists (
          select 1 from feedback_person_tags fpt
          join user_person_tags upt on upt.person_tag_id = fpt.person_tag_id
          join users u on u.id = upt.user_id
          where fpt.feedback_id = f.id and upt.user_id = pv.subject_user_id
            and u.role = 'team' and u.membership_state = 'active'
        )
      )
  `;
}

/** Same as above for every product (membership changes). */
export async function syncPersonalPlacementsForSubject(tx: Db, subjectUserId: string) {
  const products = await tx<{ productId: string }[]>`select distinct product_id from personal_views where subject_user_id = ${subjectUserId}`;
  for (const p of products) await syncPersonalPlacements(tx, p.productId);
}
