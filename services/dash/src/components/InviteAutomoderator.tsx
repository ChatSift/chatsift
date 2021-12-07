import { Center, Box, Heading, Link, Button } from '@chakra-ui/react';

const InviteAutomoderator = () => (
  <Center>
    <Box my = {{ base: 12 }} px = {{ base: 50, xl: 150 }}
      textAlign = "center">
      <Heading fontSize = "xl" mb = {6}>
        {'AutoModerator is not in this guild yet'}
      </Heading>
      <Link target = "_blank" href = {process.env.NEXT_PUBLIC_INVITE_LINK}>
        <Button>
          Invite AutoModerator
        </Button>
      </Link>
    </Box>
  </Center>
);

export default InviteAutomoderator;
