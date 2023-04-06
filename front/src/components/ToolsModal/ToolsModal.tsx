import React, { useState } from 'react';
import { Modal, Dropdown, Tabs, Menu } from 'antd';
import { pathOr } from 'ramda';
import { styled } from '~utils/styled';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlusCircle } from '@fortawesome/free-solid-svg-icons';

import styles from './ToolsModal.module.less';
import { Contract } from '~components/generated-models';
import Queries from '~layouts/manage/taskboard/Queries';
import { SessionConsumer } from '~lib/withSession';

import CreateNewTask from './CreateNewTask';
import GroupTopic from './GroupTopic';
import ScheduleMeeting from './ScheduleMeeting';
// import TrackItem from './TrackItem';
import ToolsModalTutorial from '~components/ToolsModalTutorial';
import ItemDetails from '~layouts/manage/open-item/ItemDetails';
import { GET_CONTRACT_MEMBERS } from '~graphql/chats.graphql';
import { useQuery } from '@apollo/react-hooks';

type ToolsModalProps = {
  contract: Contract;
};

const { TabPane } = Tabs;
// const MainModal = styled(styles.modal, Modal);
const MenuIcon = styled(styles.menuIcon);

const ToolsModal: React.FC<ToolsModalProps> = ({ contract }) => {
  const [isModalOpen, setModalOpen] = useState(false);
  const [currentTab, setCurrentTab] = useState('0');

  const { data: contractMembersData } = useQuery(GET_CONTRACT_MEMBERS, {
    variables: {
      contractId: contract.id
    }
  });

  const activeUsers = pathOr([], ['getContractMembers'], contractMembersData);

  const closeModal = () => setModalOpen(false);
  const menu = (
    <Menu data-cy="drop-down-menu">
      <Menu.Item
        data-cy="group-topic-button"
        onClick={() => {
          setModalOpen(true);
          setCurrentTab('0');
        }}
      >
        Group Topic
      </Menu.Item>
      <Menu.Item
        onClick={() => {
          setModalOpen(true);
          setCurrentTab('1');
        }}
      >
        Schedule
      </Menu.Item>
      <Menu.Item
        onClick={() => {
          setModalOpen(true);
          setCurrentTab('2');
        }}
      >
        New Task
      </Menu.Item>
      <Menu.Item
        onClick={() => {
          setModalOpen(true);
          setCurrentTab('3');
        }}
      >
        Open Item
      </Menu.Item>
    </Menu>
  );

  return (
    <SessionConsumer>
      {({ currentUser: user }) => {
        const userTutorials = pathOr([], ['tutorials'], user);
        const userSawTutorial = userTutorials.some(
          ({ tutorial }) => tutorial === 'ToolsModal'
        );
        return (
          <div>
            <ToolsModalTutorial userSawTutorial={userSawTutorial} />
            <Modal
              closable={false}
              footer={null}
              width="700px"
              title={null}
              visible={isModalOpen}
              //   onOk={() => this.setModal1Visible(false)}
              onCancel={() => setModalOpen(false)}
            >
              <Tabs
                type="card"
                activeKey={currentTab}
                onTabClick={(index: string) => {
                  setCurrentTab(index);
                }}
              >
                <TabPane tab="Start a Group Topic" key="0">
                  {contract && user ? (
                    <GroupTopic
                      contract={contract}
                      user={user}
                      closeModal={closeModal}
                    />
                  ) : null}
                </TabPane>
                <TabPane tab="Schedule a Meeting" key="1">
                  {contract && user ? (
                    <ScheduleMeeting
                      contract={contract}
                      user={user}
                      closeModal={closeModal}
                    />
                  ) : null}
                </TabPane>
                <TabPane tab="Create a New Task" key="2">
                  {contract ? (
                    <Queries contractId={contract.id}>
                      {({
                        taskboard: { taskboardLoading, taskboardError, data }
                      }) => {
                        if (taskboardLoading || taskboardError || !user) {
                          return null;
                        }
                        const {
                          getTaskboard: { Todo, Doing, Done }
                        } = data;
                        const allTasks = [...Todo, ...Doing, ...Done];
                        return (
                          <CreateNewTask
                            contract={contract}
                            allTasks={allTasks}
                            user={user}
                            refetchQueries={['GET_TASKBOARD_QUERY']}
                            closeModal={closeModal}
                          />
                        );
                      }}
                    </Queries>
                  ) : null}
                </TabPane>
                <TabPane tab="Track an Open Item" key="3">
                  {contract && user && (
                    <Queries contractId={contract.id}>
                      {({
                        taskboard: { taskboardLoading, taskboardError, data }
                      }) => {
                        if (taskboardLoading || taskboardError || !user) {
                          return null;
                        }
                        const {
                          getTaskboard: { Todo, Doing, Done }
                        } = data;
                        const allTasks = [...Todo, ...Doing, ...Done].sort(
                          (a, b) => {
                            const nameA = a.name.toUpperCase();
                            const nameB = b.name.toUpperCase();
                            if (nameA > nameB) return 1;
                            if (nameA < nameB) return -1;
                            return 0;
                          }
                        );
                        return (
                          <ItemDetails
                            contract={contract}
                            currentUser={user}
                            openItems={[]}
                            activeRow={'new'}
                            setActiveRow={closeModal}
                            isPreviewMode={false}
                            activeTags={pathOr([], ['tags'], contract)}
                            tasks={allTasks}
                            activeUsers={activeUsers}
                          />
                        );
                      }}
                    </Queries>
                  )}
                </TabPane>
              </Tabs>
            </Modal>
            <MenuIcon>
              <Dropdown placement="topLeft" overlay={menu} forceRender={true}>
                <a
                  className="ant-dropdown-link"
                  id="tools__modal"
                  onClick={e => e.preventDefault()}
                >
                  <FontAwesomeIcon
                    color="#54c6cc"
                    icon={faPlusCircle}
                    size="2x"
                    style={{
                      background: '#fff',
                      borderRadius: '50%',
                      cursor: 'pointer'
                    }}
                  />
                </a>
              </Dropdown>
            </MenuIcon>
          </div>
        );
      }}
    </SessionConsumer>
  );
};

export default ToolsModal;
