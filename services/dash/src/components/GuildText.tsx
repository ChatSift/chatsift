import { Tooltip, Text } from '@chakra-ui/react';

const GuildText = ({ name }: { name: string }) => name.length > 20
  ? (
    <Tooltip label = {name}>
      <Text align = "center"
        fontWeight = "semibold"
        maxWidth = "20ch"
        isTruncated>
        {name}
      </Text>
    </Tooltip>
  )
  : (
    <Text align = "center"
      fontWeight = "semibold"
      maxWidth = "20ch"
      isTruncated>
      {name}
    </Text>
  );

export default GuildText;
