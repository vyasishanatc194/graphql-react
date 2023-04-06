import React, { Component } from 'react';
import { Query, Mutation, Subscription } from '@apollo/react-components';
import {
  GET_CHAT_MEMBERS,
  ADD_CHAT_MEMBER_MUTATION,
  REMOVE_CHAT_MEMBER_MUTATION,
  CHAT_MEMBER_ADDED_SUBSCRIPTION,
  CHAT_MEMBER_REMOVED_SUBSCRIPTION
} from '~graphql/chats.graphql';
import './ChatMembers.less';
import EditChat from '~components/EditChat';
import { SessionConsumer } from '~lib/withSession';
import { pathOr } from 'ramda';
import PT from 'prop-types';

const GROUP_CHAT = 'Group';

class ChatMembers extends Component {
  static propTypes = {
    chat: PT.object.isRequired,
    contractMembers: PT.array.isRequired,
    contractId: PT.string.isRequired,
    setChatTitle: PT.func.isRequired
  };

  updateChatMembersCache = ({ isMemberAdded }) => ({
    subscriptionData,
    client
  }) => {
    const {
      chat: { id: chatId },
      contractId
    } = this.props;
    const { getChatMembers: membersList } = client.readQuery({
      query: GET_CHAT_MEMBERS,
      variables: { chatId, contractId }
    });

    const subscriberMember = pathOr(
      null,
      ['data', isMemberAdded ? 'chatMemberAdded' : 'chatMemberRemoved'],
      subscriptionData
    );
    let newMembersList;

    switch (isMemberAdded) {
      case true:
        newMembersList = membersList.find(
          member => member.id === subscriberMember.id
        )
          ? membersList
          : [...membersList, subscriberMember];
        break;
      case false:
        newMembersList = membersList.filter(
          item => item.id !== subscriberMember.id
        );
        break;
    }

    client.writeQuery({
      query: GET_CHAT_MEMBERS,
      variables: { chatId, contractId },
      data: { getChatMembers: newMembersList }
    });
  };

  render() {
    const { chat, contractMembers, contractId, setChatTitle } = this.props;
    const { type, id: chatId } = chat;

    if (type !== GROUP_CHAT) {
      return null;
    }

    return (
      <SessionConsumer>
        {({ currentUser, isAuthenticated }) => (
          <Query
            query={GET_CHAT_MEMBERS}
            variables={{ chatId, contractId }}
            fetchPolicy="cache-and-network"
          >
            {({ loading, error, data }) => (
              <Mutation mutation={ADD_CHAT_MEMBER_MUTATION}>
                {addChatMember => (
                  <Mutation mutation={REMOVE_CHAT_MEMBER_MUTATION}>
                    {removeChatMember => (
                      <Subscription
                        subscription={CHAT_MEMBER_ADDED_SUBSCRIPTION}
                        variables={{ chatId, contractId }}
                        onSubscriptionData={this.updateChatMembersCache({
                          isMemberAdded: true
                        })}
                        skip={!isAuthenticated || typeof window === 'undefined'}
                      >
                        {() => (
                          <Subscription
                            subscription={CHAT_MEMBER_REMOVED_SUBSCRIPTION}
                            variables={{ chatId, contractId }}
                            onSubscriptionData={this.updateChatMembersCache({
                              isMemberAdded: false
                            })}
                            skip={
                              !isAuthenticated || typeof window === 'undefined'
                            }
                          >
                            {() => {
                              if ((loading && !data) || error) return null;

                              const membersList = pathOr(
                                null,
                                ['getChatMembers'],
                                data
                              );

                              return (
                                <span className="edit-chat-members">
                                  {`${membersList.length} member${
                                    membersList.length > 1 ? 's' : ''
                                  }`}
                                  <EditChat
                                    removeChatMember={removeChatMember}
                                    addChatMember={addChatMember}
                                    chat={chat}
                                    contractMembers={contractMembers}
                                    members={membersList}
                                    currentUser={currentUser}
                                    setChatTitle={setChatTitle}
                                  />
                                </span>
                              );
                            }}
                          </Subscription>
                        )}
                      </Subscription>
                    )}
                  </Mutation>
                )}
              </Mutation>
            )}
          </Query>
        )}
      </SessionConsumer>
    );
  }
}

export default ChatMembers;
