import { useTranslation } from 'react-i18next'
import { UserEmailData } from '../../../../../../../types/user-email'
import { useUserEmailsContext } from '../../../context/user-email-context'
import { postJSON } from '../../../../../infrastructure/fetch-json'
import { UseAsyncReturnType } from '../../../../../shared/hooks/use-async'
import OLTooltip from '@/features/ui/components/ol/ol-tooltip'
import OLIconButton, {
  OLIconButtonProps,
} from '@/features/ui/components/ol/ol-icon-button'
import { bsVersion } from '@/features/utils/bootstrap-5'
import getMeta from '@/utils/meta'

type DeleteButtonProps = Pick<
  OLIconButtonProps,
  'disabled' | 'isLoading' | 'onClick'
>

function DeleteButton({ disabled, isLoading, onClick }: DeleteButtonProps) {
  const { t } = useTranslation()

  return (
    <OLIconButton
      variant="danger"
      disabled={disabled}
      isLoading={isLoading}
      size="small"
      onClick={onClick}
      accessibilityLabel={t('remove') || ''}
      icon={
        bsVersion({
          bs5: 'delete',
          bs3: 'trash',
        }) as string
      }
      bs3Props={{ fw: true }}
    />
  )
}

type RemoveProps = {
  userEmailData: UserEmailData
  deleteEmailAsync: UseAsyncReturnType
}

function Remove({ userEmailData, deleteEmailAsync }: RemoveProps) {
  const { t } = useTranslation()
  const { state, deleteEmail, resetLeaversSurveyExpiration } =
    useUserEmailsContext()
  const isManaged = getMeta('ol-isManagedAccount', false)

  const getTooltipText = () => {
    if (isManaged) {
      return t('your_account_is_managed_by_your_group_admin')
    }
    return userEmailData.default
      ? t('please_change_primary_to_remove')
      : t('remove')
  }

  const handleRemoveUserEmail = () => {
    deleteEmailAsync
      .runAsync(
        postJSON('/user/emails/delete', {
          body: {
            email: userEmailData.email,
          },
        })
      )
      .then(() => {
        deleteEmail(userEmailData.email)
        resetLeaversSurveyExpiration(userEmailData)
      })
      .catch(() => {})
  }

  if (deleteEmailAsync.isLoading) {
    return <DeleteButton isLoading />
  }

  return (
    <OLTooltip
      id={userEmailData.email}
      description={getTooltipText()}
      overlayProps={{ placement: userEmailData.default ? 'left' : 'top' }}
    >
      <span>
        <DeleteButton
          disabled={state.isLoading || userEmailData.default}
          onClick={handleRemoveUserEmail}
        />
      </span>
    </OLTooltip>
  )
}

export default Remove
