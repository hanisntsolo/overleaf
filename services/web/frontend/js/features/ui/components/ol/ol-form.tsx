import { Form } from 'react-bootstrap-5'
import { Form as BS3Form } from 'react-bootstrap'
import BootstrapVersionSwitcher from '@/features/ui/components/bootstrap-5/bootstrap-version-switcher'

type OLFormProps = React.ComponentProps<typeof Form> & {
  bs3Props?: React.ComponentProps<typeof BS3Form>
}

function OLForm(props: OLFormProps) {
  const { bs3Props, ...rest } = props

  const bs3FormProps: React.ComponentProps<typeof BS3Form> = {
    componentClass: rest.as,
    bsClass: rest.className,
    children: rest.children,
    ...bs3Props,
  }

  return (
    <BootstrapVersionSwitcher
      bs3={<BS3Form {...bs3FormProps} />}
      bs5={<Form {...rest} />}
    />
  )
}

export default OLForm
