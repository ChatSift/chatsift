import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  Box,
  Button,
  Flex,
  IconButton,
  Heading,
  useDisclosure,
  VStack,
  useColorModeValue,
  useColorMode
} from '@chakra-ui/react';
import { FiMenu, FiX } from 'react-icons/fi';
import { MoonIcon, SunIcon } from '@chakra-ui/icons';

const GuildNavbar = () => {
  const router = useRouter();
  const { isOpen, onToggle } = useDisclosure();
  const { isOpen: isOpenModules, onToggle: onToggleModules } = useDisclosure({
    defaultIsOpen: router.route === '/guilds/[id]/modules/automoderation'
  });

  const icon = useColorModeValue(<MoonIcon />, <SunIcon />);
  const { toggleColorMode } = useColorMode();

  const { id } = router.query;

  return (
    <Flex as = "nav" align = "center"
      justifyContent = "space-between" wrap = "wrap"
      px = {{ base: 50, lg: 4 }}>
      <Flex d = {{ base: 'block', lg: 'none' }} mb = {{ base: 4, lg: 0 }}>
        <Heading size = "md" color = "white">
          Navigation
        </Heading>
      </Flex>

      <Flex align = "center">
        <IconButton d = {{ base: 'flex', lg: 'none' }}
          mb = {{ base: 4, lg: 0 }}
          aria-label = "Open menu"
          variant = "ghost"
          icon = {isOpen ? <FiX /> : <FiMenu />}
          onClick = {onToggle}
        />
      </Flex>

      <Box d = {{ base: isOpen ? 'flex' : 'none', lg: 'block' }}
        flexDirection = {{ base: 'column' }}
        width = {{ base: 'full' }}
        mb = {{ base: 4, lg: 0 }}
      >
        <VStack px = {2}>
          <Link href = {`/guilds/${id}`}>
            <Button w = "100%"
              variant = {router.route === '/guilds/[id]' ? 'solid' : 'ghost'}
              color = {router.route === '/guilds/[id]' ? 'blue.200' : 'white'}
            >
              Dashboard
            </Button>
          </Link>

          <Button w = "100%" variant = "ghost"
            onClick = {onToggleModules}>
            Modules
          </Button>

          <Box d = {{ base: isOpenModules ? 'block' : 'none' }} w = "100%">
            <Link href = {`/guilds/${id}/modules/automoderation`}>
              <Button variant = "ghost"
                color = {router.route === '/guilds/[id]/modules/automoderation' ? 'blue.200' : 'white'}
                bg = "gray.700"
                w = "100%"
              >
                Auto Moderation
              </Button>
            </Link>
          </Box>

          <Box d = {{ base: isOpenModules ? 'block' : 'none' }} w = "100%">
            <Link href = {`/guilds/${id}/modules/logging`}>
              <Button variant = "ghost"
                color = {router.route === '/guilds/[id]/modules/logging' ? 'blue.200' : 'white'}
                bg = "gray.700"
                w = "100%"
              >
                Logging
              </Button>
            </Link>
          </Box>

          <IconButton onClick = {toggleColorMode}
            variant = "ghost"
            icon = {icon}
            aria-label = "Toggle Theme" />
        </VStack>
      </Box>
    </Flex>
  );
};

export default GuildNavbar;
